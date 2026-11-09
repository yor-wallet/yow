'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ONE_YEAR_SECONDS, THEME_COOKIE } from '@/lib/cookies';

export type Theme = 'dark' | 'light';

export const THEME_COLORS: Record<Theme, string> = { dark: '#10052E', light: '#F7F9FF' };

type ThemeContextValue = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => undefined, toggle: () => undefined });

/**
 * Theme state. The server reads the `doom_theme` cookie and renders
 * `<html data-theme>` so there is no flash; this provider keeps the client in sync.
 */
export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLORS[next]));
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
