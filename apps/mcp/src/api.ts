/** Thin HTTP client for the Tesserax API (`/api/*`). Errors carry a message an AI can act on. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface Api {
  get<T>(path: string, query?: Query): Promise<T>;
  send<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T>;
}

export class HttpApi implements Api {
  constructor(
    private readonly base: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get<T>(path: string, query?: Query): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return this.call<T>('GET', `${path}${s ? `?${s}` : ''}`);
  }

  send<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    return this.call<T>(method, path, body ?? {});
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.base}/api${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ApiError(`Tesserax is not reachable at ${this.base} (${(e as Error).message}). Ask the person to start it with \`pnpm dev\`.`, 0);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { message?: unknown };
        if (j.message !== undefined) msg = typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
      } catch {
        /* plain text */
      }
      throw new ApiError(`${method} ${path} failed (${res.status}): ${msg.slice(0, 2000)}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}
