import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startListening, transcriptToCommand } from './voice';

describe('transcriptToCommand', () => {
  it.each([
    ['keep', 'keep'],
    [' Keep. ', 'keep'],
    ['unfollow', 'unfollow'],
    ['un follow', 'unfollow'],
    ['delete', 'unfollow'],
    ['remove', 'remove'],
    ['both', 'both'],
    ['undo', 'undo'],
    ['go back', 'undo'],
    ['open', 'open'],
    ['keep keep', 'keep'],
  ])('maps %j to %s', (transcript, command) => {
    expect(transcriptToCommand(transcript)).toBe(command);
  });

  it('ignores speech that names two different commands', () => {
    expect(transcriptToCommand('keep no remove')).toBeNull();
  });

  it.each(["don't delete", 'not remove', 'follows me back'])('ignores %j', (transcript) => {
    expect(transcriptToCommand(transcript)).toBeNull();
  });

  // Talking to someone in the room shouldn't decide a card.
  it('ignores longer sentences even if they contain a command word', () => {
    expect(transcriptToCommand('I think we should keep this one')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(transcriptToCommand('hello')).toBeNull();
    expect(transcriptToCommand('')).toBeNull();
  });
});

class FakeRecognition extends EventTarget {
  static last: FakeRecognition;
  starts = 0;
  constructor() {
    super();
    FakeRecognition.last = this;
  }
  start() {
    this.starts += 1;
  }
  abort() {
    this.dispatchEvent(new Event('end'));
  }
  fail(error: string) {
    this.dispatchEvent(Object.assign(new Event('error'), { error }));
    this.dispatchEvent(new Event('end'));
  }
}

const quietHandlers = { onHeard: () => {}, onInterim: () => {}, onActivity: () => {} };

describe('startListening', () => {
  beforeEach(() => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restarts after Chrome ends a session, but not after stop', () => {
    const stop = startListening(false, { ...quietHandlers, onError: () => {} });
    const recognition = FakeRecognition.last;
    recognition.dispatchEvent(new Event('end'));
    expect(recognition.starts).toBe(2);
    stop();
    expect(recognition.starts).toBe(2);
  });

  it('stops on a blocked mic but keeps going through silence', () => {
    const onError = vi.fn();
    startListening(false, { ...quietHandlers, onError });
    const recognition = FakeRecognition.last;
    recognition.fail('no-speech');
    expect(recognition.starts).toBe(2);
    recognition.fail('not-allowed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(recognition.starts).toBe(2);
  });
});
