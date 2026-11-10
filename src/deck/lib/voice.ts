import { log } from '../../shared/log';
import type { DeckCommand } from './keyboard';

const COMMAND_WORDS: Record<string, DeckCommand> = {
  keep: 'keep',
  unfollow: 'unfollow',
  delete: 'unfollow',
  remove: 'remove',
  both: 'both',
  undo: 'undo',
  back: 'undo',
  open: 'open',
};

// Longer utterances are conversation, not commands.
const MAX_WORDS = 3;
// "don't delete" or "follows me back" isn't a command.
const VETO_WORDS = new Set(['don', 'dont', 'not', 'follow', 'follows', 'following']);

export function transcriptToCommand(transcript: string): DeckCommand | null {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\bun follow\b/g, 'unfollow')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) {
    return null;
  }
  if (words.some((word) => VETO_WORDS.has(word))) {
    return null;
  }
  const commands = new Set(words.flatMap((word) => COMMAND_WORDS[word] ?? []));
  return commands.size === 1 ? [...commands][0] : null;
}

// The Web Speech API isn't in TypeScript's DOM lib; only what's used here.
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type LocalOptions = { langs: string[]; processLocally: boolean };
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
}
type RecognitionResultEvent = Event & { resultIndex: number; results: SpeechRecognitionResultList };
type RecognitionErrorEvent = Event & { error: string };

const LANG = 'en-US';

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as Record<string, RecognitionConstructor | undefined>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return recognitionConstructor() !== null;
}

// Installs the language pack when Chrome offers one. Call from a click: the download needs a user gesture.
export async function prepareOnDevice(): Promise<boolean> {
  const Constructor = recognitionConstructor();
  if (!Constructor?.available || !Constructor.install) {
    return false;
  }
  const options = { langs: [LANG], processLocally: true };
  const availability = await Constructor.available(options);
  if (availability === 'available') {
    return true;
  }
  if (availability === 'unavailable') {
    return false;
  }
  return Constructor.install(options);
}

// waiting: mic open, nothing said. hearing: speech in progress. processing: speech ended, no text yet.
export type VoiceActivity = 'waiting' | 'hearing' | 'processing';

export type VoiceHandlers = {
  onHeard: (transcript: string, command: DeckCommand | null) => void;
  // What it's making of the words so far, before the transcript is final.
  onInterim: (transcript: string) => void;
  onActivity: (activity: VoiceActivity) => void;
  // Fatal errors only; the listener has stopped when this is called.
  onError: (message: string) => void;
};

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked for this page',
  'service-not-allowed': 'Speech recognition is turned off in Chrome',
  'audio-capture': 'No microphone found',
  network: "Couldn't reach Google's speech service",
  'language-not-supported': "English recognition isn't available here",
};

// Listens until stopped. Chrome ends a session after a silence, so it restarts on its own.
export function startListening(onDevice: boolean, handlers: VoiceHandlers): () => void {
  const Constructor = recognitionConstructor();
  if (!Constructor) {
    handlers.onError("This Chrome doesn't support speech recognition");
    return () => {};
  }
  const recognition = new Constructor();
  recognition.lang = LANG;
  recognition.continuous = true;
  recognition.interimResults = true;
  if (onDevice) {
    recognition.processLocally = true;
  }
  let stopped = false;

  recognition.addEventListener('result', (event) => {
    const { resultIndex, results } = event as RecognitionResultEvent;
    let interim = '';
    for (let index = resultIndex; index < results.length; index += 1) {
      const transcript = results[index][0].transcript.trim();
      if (results[index].isFinal) {
        handlers.onHeard(transcript, transcriptToCommand(transcript));
        handlers.onActivity('waiting');
      } else {
        interim += `${transcript} `;
      }
    }
    handlers.onInterim(interim.trim());
  });
  recognition.addEventListener('audiostart', () => handlers.onActivity('waiting'));
  recognition.addEventListener('speechstart', () => handlers.onActivity('hearing'));
  recognition.addEventListener('speechend', () => handlers.onActivity('processing'));
  recognition.addEventListener('error', (event) => {
    const code = (event as RecognitionErrorEvent).error;
    // Silence and our own abort happen all the time; anything else is worth seeing in the console.
    if (code !== 'no-speech' && code !== 'aborted') {
      log.warn('voice error', code);
    }
    const message = ERROR_MESSAGES[code];
    if (message) {
      stopped = true;
      handlers.onError(message);
    }
  });
  recognition.addEventListener('end', () => {
    if (!stopped) {
      recognition.start();
    }
  });
  recognition.start();

  return () => {
    stopped = true;
    recognition.abort();
  };
}
