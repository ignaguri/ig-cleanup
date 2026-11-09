export type Viewer = { userId: string; username: string };

const VIEWER_MARKER = '"PolarisViewer",[],';

// End of the JSON object starting at `start`, skipping braces inside strings (bios can contain them).
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

// A logged-in instagram.com page embeds the viewer in its own inline data, so no request is needed.
export function parseViewer(scriptsText: string): Viewer | null {
  const marker = scriptsText.indexOf(VIEWER_MARKER);
  if (marker === -1) {
    return null;
  }
  const start = scriptsText.indexOf('{', marker);
  const end = start === -1 ? -1 : objectEnd(scriptsText, start);
  if (end === -1) {
    return null;
  }
  try {
    const data = JSON.parse(scriptsText.slice(start, end + 1))?.data;
    if (typeof data?.id === 'string' && typeof data?.username === 'string') {
      return { userId: data.id, username: data.username };
    }
  } catch {
    return null;
  }
  return null;
}

export function isViewer(value: unknown): value is Viewer {
  const candidate = value as Partial<Viewer> | null | undefined;
  return typeof candidate?.userId === 'string' && typeof candidate?.username === 'string';
}
