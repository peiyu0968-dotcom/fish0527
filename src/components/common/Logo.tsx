import { BubbleGlyph } from './Icon';
import './Logo.css';

export function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }} aria-hidden="true">
      <BubbleGlyph size={Math.round(size * 0.58)} />
    </span>
  );
}
