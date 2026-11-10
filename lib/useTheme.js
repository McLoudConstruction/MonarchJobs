'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Light or dark for the staff app, remembered per browser. The customer pages (/e/... and /u/...)
// is always light so it reads like a document, whatever the viewer's settings are.
const ThemeContext = createContext({ theme: 'light', setTheme: () => {} });
const KEY = 'monarch-theme';

export function ThemeProvider({ children }) {
  const pathname = usePathname() || '';
  const lightOnly = pathname.startsWith('/e/') || pathname.startsWith('/u/');
  const [theme, setThemeState] = useState('light');

  useEffect(() => {
    if (lightOnly) {
      setThemeState('light');
      document.documentElement.setAttribute('data-theme', 'light');
      return;
    }
    let stored = null;
    try { stored = window.localStorage.getItem(KEY); } catch { /* storage blocked */ }
    const initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setThemeState(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, [lightOnly]);

  function setTheme(next) {
    if (lightOnly) return;
    setThemeState(next);
    try { window.localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
    document.documentElement.setAttribute('data-theme', next);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
