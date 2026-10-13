import { Avatar } from '../common/Avatar';
import './TypingIndicator.css';

function typingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} 正在輸入`;
  if (names.length === 2) return `${names[0]}、${names[1]} 正在輸入`;
  return '數人正在輸入…';
}

/** 輸入區上方的「某某 正在輸入…」。永遠保留一行高度，避免出現／消失時畫面跳動。 */
export function TypingIndicator({ names }: { names: string[] }) {
  return (
    <div className="typing" aria-live="polite">
      {names.length > 0 && (
        <>
          {names.length === 1 && <Avatar nickname={names[0]} size={22} />}
          <span>{typingText(names)}</span>
          <span className="typing__dots" aria-hidden="true">
            <i /> <i /> <i />
          </span>
        </>
      )}
    </div>
  );
}
