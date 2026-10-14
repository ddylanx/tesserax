import { createContext, useContext, type ReactNode } from 'react';

/** How the module calls the host's API. `path` starts at the API root, e.g. '/skills'. Must throw an Error with a readable message on failure. */
export interface SkillsClient {
  fetchJson<T>(path: string, init?: RequestInit): Promise<T>;
}

const Ctx = createContext<SkillsClient | null>(null);

export function SkillsClientProvider({ client, children }: { client: SkillsClient; children: ReactNode }) {
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useSkillsApi(): SkillsClient['fetchJson'] {
  const c = useContext(Ctx);
  if (!c) throw new Error('Wrap the Skills UI in <SkillsClientProvider>');
  return c.fetchJson.bind(c);
}
