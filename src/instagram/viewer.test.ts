import { describe, expect, it } from 'vitest';
import { parseViewer } from './viewer';

describe('parseViewer', () => {
  it('reads id and username from the page data, even with braces and quotes in the bio', () => {
    const page = `foo(["PolarisViewer",[],{"data":{"biography":"a \\"}} b","id":"345","username":"someone"}},123]);`;
    expect(parseViewer(page)).toEqual({ userId: '345', username: 'someone' });
  });

  it('is null when the page has no viewer (logged out)', () => {
    expect(parseViewer('nothing here')).toBeNull();
    expect(parseViewer('"PolarisViewer",[],{"data":null}')).toBeNull();
  });
});
