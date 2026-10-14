import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatError, ERROR_TEXT, type Attachment, type ChatBackend, type Message, type OnlineUser } from '../../backend/types';
import { useChat } from '../../hooks/useChat';
import type { Theme } from '../../hooks/useTheme';
import { useUnreadTitle } from '../../hooks/useUnreadTitle';
import { formatTime } from '../../rules/message';
import { Icon } from '../common/Icon';
import { Logo } from '../common/Logo';
import { Composer } from '../Composer/Composer';
import { ConnectionBanner } from '../ConnectionBanner/ConnectionBanner';
import { ImageViewer } from '../ImageViewer/ImageViewer';
import { MessageList } from '../MessageList/MessageList';
import { OnlineList } from '../OnlineList/OnlineList';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import { TypingIndicator } from '../TypingIndicator/TypingIndicator';
import './ChatRoom.css';

const TOAST_MS = 3000;

interface ChatRoomProps {
  backend: ChatBackend;
  nickname: string;
  initialOnline: OnlineUser[];
  theme: Theme;
  onToggleTheme: () => void;
  /** 離開聊天室（自己按離開，或被迫離開並附上原因）。 */
  onLeft: (notice?: string) => void;
}

export function ChatRoom({ backend, nickname, initialOnline, theme, onToggleTheme, onLeft }: ChatRoomProps) {
  const chat = useChat(backend, nickname, initialOnline);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<Message | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useUnreadTitle(chat.incomingCount);

  // 手機鍵盤彈出時，可視範圍會變小；讓整個聊天室跟著縮，輸入區才不會被遮住。
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);

  // 直接關掉網頁也算離開（盡力通知，來不及時由後端逾時判定）。
  useEffect(() => {
    const onHide = () => backend.leaveOnPageHide();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [backend]);

  // 斷線太久、代號被別人佔用等原因被迫離開：回到輸入代號畫面並說明原因。
  useEffect(
    () =>
      backend.subscribe('session.ended', ({ reason }) => {
        onLeft(
          reason === 'NICKNAME_TAKEN'
            ? '你離線太久，代號已被別人使用，請換一個代號再進入。'
            : ERROR_TEXT[reason],
        );
      }),
    [backend, onLeft],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const handleReport = useCallback(
    (id: number) => {
      chat
        .report(id)
        .then(() => {
          setReportedIds((prev) => new Set(prev).add(id));
          showToast('已收到檢舉，謝謝');
        })
        .catch((err) => {
          if (err instanceof ChatError && err.code === 'ALREADY_REPORTED') {
            setReportedIds((prev) => new Set(prev).add(id));
          }
          showToast(err instanceof ChatError ? ERROR_TEXT[err.code] : ERROR_TEXT.NETWORK);
        });
    },
    [chat, showToast],
  );

  const handleUpload = useCallback(
    (file: File, onProgress: (percent: number) => void): Promise<Attachment> => backend.uploadFile(file, onProgress),
    [backend],
  );

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    try {
      await backend.leaveRoom();
    } finally {
      onLeft();
    }
  }

  const offline = chat.connection !== 'connected';

  return (
    <div className="room">
      <div className="room__shell">
        <header className="room__header">
          <div className="room__brand">
            <Logo />
            <h1>匿名聊天室</h1>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button type="button" className="room__leave" onClick={() => void leave()} disabled={leaving}>
              <Icon name="logout" size={18} strokeWidth={2.2} />
              離開
            </button>
          </div>
          <OnlineList users={chat.online} me={nickname} />
        </header>

        <ConnectionBanner connection={chat.connection} onRetry={chat.retry} />

        <MessageList
          messages={chat.messages}
          hasMore={chat.hasMore}
          loadingInitial={chat.loadingInitial}
          loadingOlder={chat.loadingOlder}
          reportedIds={reportedIds}
          onLoadOlder={() => void chat.loadOlder()}
          onEdit={chat.edit}
          onDelete={chat.remove}
          onReport={handleReport}
          onOpenImage={setViewing}
        />

        {toast && (
          <div className="room__toast" role="status">
            <Icon name="check" size={18} strokeWidth={3} />
            {toast}
          </div>
        )}

        <TypingIndicator names={chat.typing} />
        <Composer disabled={offline} onSend={chat.send} onUpload={handleUpload} onTyping={chat.notifyTyping} />
      </div>

      {viewing?.attachment && (
        <ImageViewer
          attachment={viewing.attachment}
          caption={`${viewing.nickname} · ${formatTime(viewing.createdAt)}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
