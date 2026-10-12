export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UNREACHABLE = 'Cannot reach the API on 127.0.0.1:4400. Is `pnpm dev` running? Check its terminal: the API may have stopped with an error.';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } }).catch(() => {
    throw new ApiError(0, UNREACHABLE);
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Vite's proxy answers 500 with an empty body when the API is down.
    if ((res.status === 500 || res.status === 502 || res.status === 504) && !text.trim()) throw new ApiError(res.status, UNREACHABLE);
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: unknown };
      if (j.message) message = Array.isArray(j.message) ? j.message.join('; ') : String(j.message);
    } catch {
      /* plain text */
    }
    throw new ApiError(res.status, `${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}
