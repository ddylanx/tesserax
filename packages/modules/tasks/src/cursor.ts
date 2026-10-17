export interface TaskCursor {
  u: string | null;
  id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: TaskCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): TaskCursor | null {
  if (!s || typeof s !== 'string') return null;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const { u, id } = parsed as { u?: unknown; id?: unknown };
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return null;
    }
    if (u === null) {
      return { u: null, id };
    }
    if (typeof u === 'string' && !Number.isNaN(Date.parse(u))) {
      return { u, id };
    }
    return null;
  } catch {
    return null;
  }
}
