import { useState } from 'react';
import type { MockDebugControls } from '../../backend/mockBackend';
import './DebugPanel.css';

/** 階段一的測試面板：網址加上 ?debug=1 才會出現，用來模擬斷線、限速、檢舉等情況。 */
export function DebugPanel({ controls }: { controls: MockDebugControls }) {
  const [open, setOpen] = useState(true);

  return (
    <aside className="debug" aria-label="測試面板">
      <button type="button" className="debug__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        測試面板 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="debug__body">
          <p>連線</p>
          <button type="button" onClick={() => controls.disconnect(5000)}>斷線，5 秒後自動恢復</button>
          <button type="button" onClick={() => controls.disconnect(null)}>斷線，30 秒後顯示「無法連線」</button>
          <button type="button" onClick={() => controls.failConnection()}>立刻顯示「無法連線」</button>
          <button type="button" onClick={() => controls.reconnect()}>立刻恢復連線</button>
          <p>情境</p>
          <button type="button" onClick={() => controls.forceRateLimit()}>下一次送出算「說話太快」</button>
          <button type="button" onClick={() => controls.botSay()}>讓機器人說一句話</button>
          <button type="button" onClick={() => controls.botReportLatest()}>讓 2 位機器人檢舉最新一則別人的訊息</button>
          <p>資料</p>
          <button type="button" onClick={() => controls.reset()}>重設所有資料並重新整理</button>
        </div>
      )}
    </aside>
  );
}
