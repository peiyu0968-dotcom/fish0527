import { useState, type FormEvent } from 'react';
import { ChatError, ERROR_TEXT, type ChatBackend, type OnlineUser } from '../../backend/types';
import type { Theme } from '../../hooks/useTheme';
import { NICKNAME_MAX, NICKNAME_PROBLEM_TEXT, checkNickname, nicknameLength } from '../../rules/nickname';
import { Icon } from '../common/Icon';
import { BubbleGlyph } from '../common/Icon';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import './JoinScreen.css';

const NICKNAME_STORAGE_KEY = 'chat.nickname';

function readRemembered(): string {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface JoinScreenProps {
  backend: ChatBackend;
  theme: Theme;
  onToggleTheme: () => void;
  onJoined: (nickname: string, online: OnlineUser[]) => void;
  /** 被擠下線或斷線太久時，回到這裡並說明原因。 */
  notice?: string | null;
}

export function JoinScreen({ backend, theme, onToggleTheme, onJoined, notice }: JoinScreenProps) {
  const [remembered] = useState(readRemembered);
  const [value, setValue] = useState(remembered);
  const [entering, setEntering] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const check = checkNickname(value);
  const localProblem = value.length > 0 && check !== 'ok' ? NICKNAME_PROBLEM_TEXT[check as Exclude<typeof check, 'ok'>] : null;
  const error = localProblem ?? serverError;
  const canSubmit = check === 'ok' && !entering;
  const count = nicknameLength(value);
  const autoFilled = remembered !== '' && value === remembered && !error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setEntering(true);
    setServerError(null);
    try {
      const online = await backend.joinRoom(value);
      try {
        localStorage.setItem(NICKNAME_STORAGE_KEY, value);
      } catch {
        /* 存不了也沒關係，只是下次不會自動填入 */
      }
      onJoined(value, online);
    } catch (err) {
      const code = err instanceof ChatError ? err.code : 'NETWORK';
      setServerError(ERROR_TEXT[code]);
      setEntering(false);
    }
  }

  return (
    <div className="join">
      <div className="join__blob join__blob--1" aria-hidden="true" />
      <div className="join__blob join__blob--2" aria-hidden="true" />
      <div className="join__blob join__blob--3" aria-hidden="true" />
      <div className="join__blob join__blob--4" aria-hidden="true" />

      <div className="join__top">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="join__center">
        <main className="join__card">
          <div className="join__brand">
            <div className="join__mark" aria-hidden="true">
              <BubbleGlyph size={36} />
              <span className="join__dot join__dot--yellow" />
              <span className="join__dot join__dot--coral" />
            </div>
            <h1 className="join__title">匿名聊天室</h1>
            <p className="join__subtitle">不用註冊，取個代號就能開聊</p>
          </div>

          {notice && (
            <p className="join__notice" role="status">
              <Icon name="info" size={18} />
              <span>{notice}</span>
            </p>
          )}

          <form className="join__form" onSubmit={submit} noValidate>
            <div className="join__label-row">
              <label htmlFor="nickname" className="join__label">
                你的代號
              </label>
              <span className={`join__count${error ? ' join__count--error' : ''}`}>
                {count}/{NICKNAME_MAX}
              </span>
            </div>
            <input
              id="nickname"
              className={`join__input${error ? ' join__input--error' : ''}`}
              type="text"
              value={value}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={error ? true : undefined}
              aria-describedby="nickname-hint"
              disabled={entering}
              onChange={(e) => {
                setValue(e.target.value);
                setServerError(null);
              }}
            />

            {autoFilled && (
              <p className="join__autofill">
                <Icon name="check" size={16} />
                已自動填入你上次使用的代號
              </p>
            )}
            {error && (
              <p className="join__error" role="alert">
                <Icon name="alert" size={18} strokeWidth={2.4} />
                {error}
              </p>
            )}
            <p id="nickname-hint" className="join__hint">
              1–{NICKNAME_MAX} 個字，只能用中文、英文、數字
            </p>

            <button type="submit" className="btn-primary join__submit" disabled={!canSubmit}>
              {entering ? (
                <>
                  <Icon name="spinner" size={20} strokeWidth={3} className="spin" />
                  進入中…
                </>
              ) : (
                '進入聊天室'
              )}
            </button>
          </form>
        </main>

        <p className="join__reminder">
          <Icon name="info" size={18} />
          <span>提醒：所有訊息都會永久保存，而且所有人都看得到。</span>
        </p>
      </div>
    </div>
  );
}
