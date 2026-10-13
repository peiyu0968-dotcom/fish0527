import { nicknameColorIndex, nicknameInitial } from '../../rules/nickname';

interface AvatarProps {
  nickname: string;
  size?: number;
}

/** 代號第一個字，底色與文字色依代號算出固定的一組。 */
export function Avatar({ nickname, size = 34 }: AvatarProps) {
  const c = nicknameColorIndex(nickname) + 1;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `var(--a${c})`,
        color: `var(--n${c})`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.41),
        fontWeight: 900,
      }}
    >
      {nicknameInitial(nickname)}
    </span>
  );
}

/** 代號文字色（CSS 變數名稱）。 */
export function nicknameColorVar(nickname: string): string {
  return `var(--n${nicknameColorIndex(nickname) + 1})`;
}
