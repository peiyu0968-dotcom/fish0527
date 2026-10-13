import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../../backend/types';
import { Icon } from '../common/Icon';
import { MessageItem } from '../MessageItem/MessageItem';
import './MessageList.css';

const NEAR_BOTTOM_PX = 56;
const NEAR_TOP_PX = 120;

interface MessageListProps {
  messages: Message[];
  hasMore: boolean;
  loadingInitial: boolean;
  loadingOlder: boolean;
  reportedIds: Set<number>;
  onLoadOlder: () => void;
  onEdit: (id: number, text: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReport: (id: number) => void;
  onOpenImage: (message: Message) => void;
}

export function MessageList({
  messages,
  hasMore,
  loadingInitial,
  loadingOlder,
  reportedIds,
  onLoadOlder,
  onEdit,
  onDelete,
  onReport,
  onOpenImage,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 人在最底下嗎？
  const seenId = useRef(0); // 人在最底下時，看過的最新一則
  const prevFirstId = useRef<number | null>(null);
  const prevLastId = useRef<number | null>(null);
  const prevHeight = useRef(0);
  const [pending, setPending] = useState(0);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const lastMsg = messages[messages.length - 1];
  const firstId = messages[0]?.id ?? null;
  const lastId = lastMsg?.id ?? null;

  // 訊息變動後調整捲動位置。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prepended = prevFirstId.current !== null && firstId !== null && firstId < prevFirstId.current;
    const appended = prevLastId.current !== null && lastId !== null && lastId > prevLastId.current;
    const initial = prevLastId.current === null && lastId !== null;

    if (initial) {
      scrollToBottom();
      seenId.current = lastId ?? 0;
    } else if (prepended) {
      // 載入了更早的訊息：保持使用者正在看的那一則不動。
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (appended) {
      if (stick.current || lastMsg?.isMine) {
        scrollToBottom();
        seenId.current = lastId ?? 0;
      }
    }

    prevFirstId.current = firstId;
    prevLastId.current = lastId;
    prevHeight.current = el.scrollHeight;
  }, [firstId, lastId, lastMsg?.isMine, scrollToBottom]);

  // 「有 N 則新訊息」只算別人送的一般訊息。
  useEffect(() => {
    if (stick.current) {
      setPending(0);
      return;
    }
    setPending(messages.filter((m) => m.id > seenId.current && m.kind === 'chat' && !m.isMine).length);
  }, [messages]);

  // 圖片等內容晚一點才載入完、讓高度變高時，人在最底下就繼續貼底。
  const listVisible = !loadingInitial && messages.length > 0;
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
      if (el) prevHeight.current = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [listVisible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= NEAR_BOTTOM_PX;
    stick.current = atBottom;
    prevHeight.current = el.scrollHeight;
    if (atBottom) {
      seenId.current = lastId ?? seenId.current;
      setPending((p) => (p === 0 ? p : 0));
    }
    if (el.scrollTop <= NEAR_TOP_PX && hasMore && !loadingOlder) onLoadOlder();
  };

  const jumpToLatest = () => {
    stick.current = true;
    scrollToBottom(true);
    seenId.current = lastId ?? seenId.current;
    setPending(0);
  };

  if (loadingInitial) {
    return (
      <div className="mlist mlist--status" aria-busy="true">
        <div className="mlist__loading" role="status">
          <Icon name="spinner" size={16} strokeWidth={3} className="spin" />
          載入歷史訊息中…
        </div>
        <div className="skel" aria-hidden="true">
          <div className="skel__row"><i className="skel__avatar" /><div><i className="skel__name" /><i className="skel__bubble skel__bubble--a" /></div></div>
          <div className="skel__row skel__row--mine"><i className="skel__bubble skel__bubble--mine skel__bubble--b" /></div>
          <div className="skel__row"><i className="skel__avatar" /><div><i className="skel__name" /><i className="skel__bubble skel__bubble--c" /></div></div>
          <div className="skel__row skel__row--mine"><i className="skel__bubble skel__bubble--mine skel__bubble--d" /></div>
          <div className="skel__row"><i className="skel__avatar" /><div><i className="skel__name" /><i className="skel__bubble skel__bubble--e" /></div></div>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="mlist mlist--status">
        <div className="empty">
          <div className="empty__art" aria-hidden="true">
            <i className="empty__b1" />
            <i className="empty__b2" />
            <i className="empty__b3" />
          </div>
          <h2>還沒有人說話</h2>
          <p>
            當第一個打招呼的人吧！
            <br />
            在下面輸入訊息，按送出就能開始。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mlist">
      <div className="mlist__scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-label="聊天訊息" tabIndex={0}>
        <div className="mlist__inner" ref={innerRef}>
          {loadingOlder && (
            <div className="mlist__loading" role="status">
              <Icon name="spinner" size={16} strokeWidth={3} className="spin" />
              載入更早的訊息…
            </div>
          )}
          {!hasMore && !loadingOlder && (
            <div className="mlist__start">
              <span>
                <Icon name="flag" size={14} />
                已經是最早的訊息
              </span>
            </div>
          )}
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              reported={reportedIds.has(m.id)}
              onEdit={onEdit}
              onDelete={onDelete}
              onReport={onReport}
              onOpenImage={onOpenImage}
            />
          ))}
        </div>
      </div>

      {pending > 0 && (
        <button type="button" className="mlist__jump" onClick={jumpToLatest}>
          有 {pending} 則新訊息
          <Icon name="arrowDown" size={18} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
