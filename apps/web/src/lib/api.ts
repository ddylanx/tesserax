export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}
