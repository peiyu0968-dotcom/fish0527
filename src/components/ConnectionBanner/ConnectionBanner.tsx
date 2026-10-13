import type { ConnectionState } from '../../backend/types';
import { Icon } from '../common/Icon';
import './ConnectionBanner.css';

interface ConnectionBannerProps {
  connection: ConnectionState;
  onRetry: () => void;
}

/** 平常不顯示；斷線時出現在頂部列下方。 */
export function ConnectionBanner({ connection, onRetry }: ConnectionBannerProps) {
  if (connection === 'connected') return null;

  if (connection === 'reconnecting') {
    return (
      <div className="conn conn--warn" role="status">
        <Icon name="spinner" size={18} strokeWidth={3} className="spin" />
        連線中斷，重新連線中…
      </div>
    );
  }

  return (
    <div className="conn conn--error" role="alert">
      <Icon name="wifiOff" size={18} strokeWidth={2.4} />
      <span className="conn__text">無法連線</span>
      <button type="button" className="conn__retry" onClick={onRetry}>
        重試
      </button>
    </div>
  );
}
