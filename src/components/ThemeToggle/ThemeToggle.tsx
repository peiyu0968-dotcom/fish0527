import type { Theme } from '../../hooks/useTheme';
import { Icon } from '../common/Icon';
import './ThemeToggle.css';

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
  size?: number;
}

export function ThemeToggle({ theme, onToggle, size = 44 }: ThemeToggleProps) {
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      style={{ width: size, height: size }}
      aria-label={theme === 'dark' ? '切換成淺色外觀' : '切換成深色外觀'}
      onClick={onToggle}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
