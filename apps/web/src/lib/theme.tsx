import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Same key and logic as the inline script in index.html, which sets the class before first paint. */
const STORAGE_KEY = 'tesserax:theme';

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

interface ThemeState {
  pref: ThemePref;
  /** What is shown right now (System resolved through prefers-color-scheme). */
  theme: Theme;
  setPref: (pref: ThemePref) => void;
}

const Ctx = createContext<ThemeState>({ pref: 'system', theme: 'light', setPref: () => undefined });

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState(readPref);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo(() => ({ pref, theme, setPref }), [pref, theme, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
