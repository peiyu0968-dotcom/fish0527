import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ChatError, ERROR_TEXT, type Attachment } from '../../backend/types';
import { MAX_FILE_BYTES, formatSize, isEmptyMessage } from '../../rules/message';
import { Icon } from '../common/Icon';
import './Composer.css';

const TYPING_THROTTLE_MS = 2000;
const ERROR_VISIBLE_MS = 5000;

type Upload =
  | { status: 'uploading'; name: string; size: number; percent: number; previewUrl: string | null }
  | { status: 'ready'; name: string; size: number; attachment: Attachment }
  | { status: 'error'; name: string; size: number; message: string };

interface ComposerProps {
  disabled: boolean;
  onSend: (text: string, attachment: Attachment | null) => Promise<void>;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<Attachment>;
  onTyping: () => void;
}

/** 電腦（有滑鼠）：Enter 送出、Shift+Enter 換行。手機（觸控）：Enter 換行，用按鈕送出。 */
function enterSends(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function Composer({ disabled, onSend, onUpload, onTyping }: ComposerProps) {
  const [text, setText] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // 輸入框依內容自動長高（有上限，超過就在框裡捲動）。
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [error]);

  const attachment = upload?.status === 'ready' ? upload.attachment : null;
  const uploading = upload?.status === 'uploading';
  const blocked = upload?.status === 'error';
  const canSend = !disabled && !sending && !uploading && !blocked && !isEmptyMessage(text, attachment !== null);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    setError(null);
    const now = Date.now();
    if (e.target.value && now - lastTyping.current > TYPING_THROTTLE_MS) {
      lastTyping.current = now;
      onTyping();
    }
  }

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text, attachment);
      setText('');
      setUpload(null);
      areaRef.current?.focus();
    } catch (err) {
      // 失敗時輸入的內容與附件都保留，使用者不會白打。
      setError(err instanceof ChatError ? ERROR_TEXT[err.code] : ERROR_TEXT.NETWORK);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!enterSends()) return;
    e.preventDefault();
    void submit();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setUpload({ status: 'error', name: file.name, size: file.size, message: ERROR_TEXT.FILE_TOO_LARGE });
      return;
    }
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setUpload({ status: 'uploading', name: file.name, size: file.size, percent: 0, previewUrl });
    try {
      const attached = await onUpload(file, (percent) =>
        setUpload((u) => (u && u.status === 'uploading' ? { ...u, percent } : u)),
      );
      setUpload({ status: 'ready', name: file.name, size: file.size, attachment: attached });
    } catch (err) {
      const message = err instanceof ChatError ? ERROR_TEXT[err.code] : ERROR_TEXT.NETWORK;
      setUpload({ status: 'error', name: file.name, size: file.size, message });
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  }

  return (
    <footer className="composer">
      {error && (
        <div className="composer__alert" role="alert">
          <Icon name="clock" size={18} strokeWidth={2.4} />
          {error}
        </div>
      )}

      {upload && (
        <div className="composer__upload">
          {upload.status === 'error' ? (
            <div className="upload upload--error" role="alert">
              <Icon name="alert" size={20} strokeWidth={2.4} />
              <div className="upload__info">
                <b>
                  {upload.name} · {formatSize(upload.size)}
                </b>
                <span>{upload.message}</span>
              </div>
              <button type="button" className="upload__x" aria-label={`移除附件 ${upload.name}`} onClick={() => setUpload(null)}>
                <Icon name="x" size={18} strokeWidth={2.6} />
              </button>
            </div>
          ) : (
            <div className="upload">
              <div className="upload__thumb" aria-hidden="true">
                {upload.status === 'uploading' && upload.previewUrl ? (
                  <img src={upload.previewUrl} alt="" />
                ) : upload.status === 'ready' && upload.attachment.kind === 'image' && upload.attachment.url ? (
                  <img src={upload.attachment.url} alt="" />
                ) : (
                  <Icon name="doc" size={20} />
                )}
              </div>
              <div className="upload__info">
                <div className="upload__row">
                  <b>
                    {upload.name} · {formatSize(upload.size)}
                  </b>
                  <span>{upload.status === 'uploading' ? `上傳中 ${upload.percent}%` : '已就緒'}</span>
                </div>
                <div
                  className="upload__bar"
                  role="progressbar"
                  aria-label="上傳進度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={upload.status === 'uploading' ? upload.percent : 100}
                >
                  <i style={{ width: `${upload.status === 'uploading' ? upload.percent : 100}%` }} />
                </div>
              </div>
              <button type="button" className="upload__x" aria-label={`取消附件 ${upload.name}`} onClick={() => setUpload(null)}>
                <Icon name="x" size={18} strokeWidth={2.6} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="composer__row">
        <input ref={fileRef} type="file" className="visually-hidden" tabIndex={-1} onChange={handleFile} />
        <button
          type="button"
          className="icon-btn composer__attach"
          aria-label="附加圖片或檔案"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="paperclip" size={22} />
        </button>

        <textarea
          ref={areaRef}
          className="composer__input"
          rows={1}
          aria-label="輸入訊息"
          placeholder={disabled ? '連線後才能傳送訊息' : '輸入訊息…'}
          value={text}
          disabled={disabled}
          enterKeyHint="enter"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />

        <button type="button" className="composer__send" aria-label="送出" disabled={!canSend} onClick={() => void submit()}>
          <Icon name="arrowUp" size={22} strokeWidth={2.6} />
        </button>
      </div>

      <p className="composer__hint">Enter 送出　·　Shift + Enter 換行</p>
    </footer>
  );
}
