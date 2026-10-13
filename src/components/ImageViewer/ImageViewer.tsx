import { useEffect, useRef } from 'react';
import type { Attachment } from '../../backend/types';
import { formatSize } from '../../rules/message';
import { Icon } from '../common/Icon';
import './ImageViewer.css';

interface ImageViewerProps {
  attachment: Attachment;
  caption: string; // 例如「Mia · 14:33」
  onClose: () => void;
}

export function ImageViewer({ attachment, caption, onClose }: ImageViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="圖片檢視" onClick={onClose}>
      <div className="viewer__bar" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="viewer__close" aria-label="關閉圖片" onClick={onClose}>
          <Icon name="x" size={22} strokeWidth={2.6} />
        </button>
        <a className="viewer__download" href={attachment.url} download={attachment.name}>
          <Icon name="download" size={20} strokeWidth={2.6} />
          下載
        </a>
      </div>
      <div className="viewer__stage">
        <img className="viewer__img" src={attachment.url} alt={attachment.name} onClick={(e) => e.stopPropagation()} />
        <p className="viewer__caption" onClick={(e) => e.stopPropagation()}>
          <strong>{attachment.name}</strong>
          <br />
          <span>
            {formatSize(attachment.size)} · {caption}
          </span>
        </p>
      </div>
    </div>
  );
}
