import { useEffect, useRef } from 'react';

const BASE_TITLE = '匿名聊天室';

/**
 * 分頁在背景時，新訊息會讓標題變成「(3) 匿名聊天室」；回到分頁後清除。
 * 只算別人的一般訊息。
 */
export function useUnreadTitle(unreadSignal: number): void {
  const unread = useRef(0);
  const last = useRef(unreadSignal);

  useEffect(() => {
    const render = () => {
      document.title = unread.current > 0 ? `(${unread.current}) ${BASE_TITLE}` : BASE_TITLE;
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        unread.current = 0;
        render();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      document.title = BASE_TITLE;
    };
  }, []);

  useEffect(() => {
    const delta = unreadSignal - last.current;
    last.current = unreadSignal;
    if (delta > 0 && document.visibilityState === 'hidden') {
      unread.current += delta;
      document.title = `(${unread.current}) ${BASE_TITLE}`;
    }
  }, [unreadSignal]);
}
