import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChatError, ERROR_TEXT, type Message } from '../../backend/types';
import { formatSize, formatTime } from '../../rules/message';
import { linkify } from '../../rules/linkify';
import { Avatar, nicknameColorVar } from '../common/Avatar';
import { Icon } from '../common/Icon';
import './MessageItem.css';

interface MessageItemProps {
  message: Message;
  reported: boolean;
  onEdit: (id: number, text: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReport: (id: number) => void;
  onOpenImage: (message: Message) => void;
}

function errorText(err: unknown): string {
  return err instanceof ChatError ? ERROR_TEXT[err.code] : ERROR_TEXT.NETWORK;
}

/** 文字內容：永遠當純文字顯示（絕不當網頁語法），只有 http(s) 網址會變成連結。 */
function RichText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <>
      {linkify(text).map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            className={mine ? 'link link--mine' : 'link'}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

function MessageItemInner({ message, reported, onEdit, onDelete, onReport, onOpenImage }: MessageItemProps) {
  const [open, setOpen] = useState(false); // 手機：點一下訊息展開操作
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { kind, nickname, isMine: mine } = message;

  if (kind !== 'chat') {
    return (
      <div className="sys">
        <span>
          {nickname} {kind === 'join' ? '進入了聊天室' : '離開了聊天室'}
        </span>
      </div>
    );
  }

  const time = formatTime(message.createdAt);
  const covered = message.deleted || message.hidden;
  const att = message.attachment;

  const toggleOpen = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input')) return;
    setOpen((v) => !v);
  };

  const startEdit = () => {
    setDraft(message.text);
    setEditing(true);
    setError(null);
  };

  const saveEdit = async () => {
    if (busy) return;
    if (draft === message.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onEdit(message.id, draft);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(message.id);
    } catch (err) {
      setError(errorText(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const body = (() => {
    if (message.deleted) return <div className="bubble bubble--deleted">此訊息已刪除</div>;
    if (message.hidden) {
      return (
        <div className="bubble bubble--hidden">
          <Icon name="eyeOff" size={18} strokeWidth={2} />
          此訊息因多人檢舉已隱藏
        </div>
      );
    }
    if (editing) {
      return (
        <div className="edit">
          <label htmlFor={`edit-${message.id}`} className="edit__label">
            編輯訊息
          </label>
          <input
            id={`edit-${message.id}`}
            className="edit__input"
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditKey}
          />
          <div className="edit__actions">
            <button type="button" className="pill-btn" onClick={() => setEditing(false)} disabled={busy}>
              取消
            </button>
            <button type="button" className="pill-btn pill-btn--cta" onClick={() => void saveEdit()} disabled={busy}>
              儲存
            </button>
          </div>
        </div>
      );
    }
    return (
      <>
        {message.text && (
          <div className="bubble bubble--text">
            <RichText text={message.text} mine={mine} />
          </div>
        )}
        {att?.kind === 'image' && (
          <button
            type="button"
            className="att-image"
            aria-label={`放大圖片 ${att.name}`}
            onClick={() => onOpenImage(message)}
          >
            {att.url ? (
              <img src={att.url} alt={att.name} loading="lazy" />
            ) : (
              <span className="att-image__missing">圖片無法顯示</span>
            )}
            <span className="att-image__cap">
              <b>{att.name}</b>
              <span>{formatSize(att.size)}</span>
            </span>
          </button>
        )}
        {att?.kind === 'file' && (
          <div className="att-file">
            <span className="att-file__icon" aria-hidden="true">
              <Icon name="doc" size={22} />
            </span>
            <span className="att-file__info">
              <b>{att.name}</b>
              <span>{formatSize(att.size)}</span>
            </span>
            {att.url ? (
              <a className="att-file__dl" href={att.url} download={att.name} aria-label={`下載 ${att.name}`}>
                <Icon name="download" size={20} strokeWidth={2.4} />
              </a>
            ) : (
              <span className="att-file__dl att-file__dl--off" role="img" aria-label="重新整理後，這個檔案已無法下載">
                <Icon name="download" size={20} strokeWidth={2.4} />
              </span>
            )}
          </div>
        )}
      </>
    );
  })();

  const showActions = !covered && !editing;

  return (
    <div className={`msg ${mine ? 'msg--mine' : 'msg--other'}${open ? ' msg--open' : ''}`}>
      {!mine && <Avatar nickname={nickname} />}
      <div className="msg__col" onClick={toggleOpen}>
        {!mine && (
          <div className="msg__head">
            <span className="msg__name" style={{ color: nicknameColorVar(nickname) }}>
              {nickname}
            </span>
            <span className="msg__time">{time}</span>
            {message.edited && <span className="msg__edited">已編輯</span>}
          </div>
        )}

        {body}

        {mine && !editing && (
          <div className="msg__meta">
            {message.edited && <b>已編輯</b>}
            <span>{time}</span>
          </div>
        )}

        {showActions && (
          <div className="msg__actions">
            {mine && !confirming && (
              <>
                <button type="button" className="chip-btn" onClick={startEdit}>
                  <Icon name="pencil" size={14} />
                  編輯
                </button>
                <button type="button" className="chip-btn chip-btn--danger" onClick={() => setConfirming(true)}>
                  <Icon name="trash" size={14} />
                  刪除
                </button>
              </>
            )}
            {mine && confirming && (
              <>
                <span className="msg__confirm">刪除這則訊息？</span>
                <button type="button" className="chip-btn" onClick={() => setConfirming(false)} disabled={busy}>
                  取消
                </button>
                <button type="button" className="chip-btn chip-btn--danger" onClick={() => void confirmDelete()} disabled={busy}>
                  確定刪除
                </button>
              </>
            )}
            {!mine &&
              (reported ? (
                <span className="msg__reported">
                  <Icon name="check" size={14} strokeWidth={2.4} />
                  已檢舉
                </span>
              ) : (
                <button type="button" className="link-btn" onClick={() => onReport(message.id)}>
                  <Icon name="flag" size={14} />
                  檢舉
                </button>
              ))}
          </div>
        )}

        {error && (
          <p className="msg__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemInner);
