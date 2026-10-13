import { useEffect, useRef, useState } from 'react';
import type { OnlineUser } from '../../backend/types';
import { Avatar } from '../common/Avatar';
import { Icon } from '../common/Icon';
import './OnlineList.css';

interface OnlineListProps {
  users: OnlineUser[];
  me: string;
}

/** 「N 人在線」按鈕，點一下展開名單，再點、按 Esc 或點旁邊收起。 */
export function OnlineList({ users, me }: OnlineListProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 自己排在最上面。
  const sorted = [...users].sort((a, b) => Number(b.nickname === me) - Number(a.nickname === me));
  const preview = sorted.slice(0, 3);

  return (
    <div className="online" ref={wrapRef}>
      <button
        type="button"
        className="online__button"
        aria-expanded={open}
        aria-controls="online-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="online__stack" aria-hidden="true">
          {preview.map((u) => (
            <span className="online__stack-item" key={u.nickname}>
              <Avatar nickname={u.nickname} size={26} />
            </span>
          ))}
        </span>
        <span className="online__count">
          <span className="online__dot" aria-hidden="true" />
          {users.length} 人在線
        </span>
        <Icon name="chevronDown" size={16} strokeWidth={2.6} className={open ? 'online__chev online__chev--open' : 'online__chev'} />
      </button>

      {open && (
        <section id="online-panel" className="online__panel" aria-label="目前線上的人">
          <div className="online__panel-head">
            <h2>目前線上</h2>
            <span>{users.length} 人</span>
          </div>
          <ul>
            {sorted.map((u) => (
              <li key={u.nickname}>
                <Avatar nickname={u.nickname} size={32} />
                <span className={u.nickname === me ? 'online__name online__name--me' : 'online__name'}>{u.nickname}</span>
                {u.nickname === me && <span className="online__me">你</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
