import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function readInitial(): Theme {
  // index.html 開頭已經先決定好並寫在 <html data-theme> 上了。
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('chat.theme', next);
      } catch {
        /* 無痕模式等情況存不了，不影響使用 */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
