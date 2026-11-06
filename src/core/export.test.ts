import { describe, expect, it } from 'vitest';
import type { Person } from '../shared/types';
import { applyExportDates, parseExport } from './export';

const entry = (value: string, timestamp: number) => ({
  string_list_data: [{ href: `https://www.instagram.com/${value}`, value, timestamp }],
});

describe('parseExport', () => {
  it('reads followers from value and converts seconds to ms', () => {
    const text = JSON.stringify([entry('Anna', 1600000000)]);
    const dates = parseExport([{ name: 'followers_1.json', text }]);
    expect(dates.followers.get('anna')).toBe(1600000000000);
  });

  it('reads following from title when value is missing', () => {
    const text = JSON.stringify({
      relationships_following: [
        {
          title: 'marc',
          string_list_data: [{ href: 'https://www.instagram.com/marc', timestamp: 1500000000 }],
        },
      ],
    });
    const dates = parseExport([{ name: 'connections/following.json', text }]);
    expect(dates.following.get('marc')).toBe(1500000000000);
  });

  it('falls back to the href last segment', () => {
    const text = JSON.stringify([
      { string_list_data: [{ href: 'https://www.instagram.com/_u/lucia/', timestamp: 1 }] },
    ]);
    const dates = parseExport([{ name: 'followers_1.json', text }]);
    expect(dates.followers.get('lucia')).toBe(1000);
  });

  it('merges multiple followers files', () => {
    const dates = parseExport([
      { name: 'followers_1.json', text: JSON.stringify([entry('a', 1)]) },
      { name: 'followers_2.json', text: JSON.stringify([entry('b', 2)]) },
    ]);
    expect([...dates.followers.keys()].sort()).toEqual(['a', 'b']);
  });

  it('skips malformed entries without throwing', () => {
    const text = JSON.stringify([{ title: 'x' }, entry('ok', 5)]);
    const dates = parseExport([{ name: 'followers_1.json', text }]);
    expect([...dates.followers.keys()]).toEqual(['ok']);
  });
});

describe('applyExportDates', () => {
  it('counts matched and unmatched and returns only changed people', () => {
    const person = { username: 'anna', iFollowedAt: null, theyFollowedAt: null } as Person;
    const dates = {
      followers: new Map([
        ['anna', 1000],
        ['ghost', 2000],
        ['zed', 3000],
      ]),
      following: new Map<string, number>(),
    };
    const result = applyExportDates([person, { ...person, username: 'zed', theyFollowedAt: 3000 }], dates);
    expect(result.matched).toBe(2);
    expect(result.unmatched).toBe(1);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].theyFollowedAt).toBe(1000);
  });
});
