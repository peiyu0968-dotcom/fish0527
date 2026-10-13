// 訊息相關規則（兩個階段共用）。

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 單檔上限 10 MB
export const RATE_LIMIT_COUNT = 5; // 10 秒內最多 5 則
export const RATE_LIMIT_WINDOW_MS = 10_000;
export const HISTORY_PAGE_SIZE = 50;

/** 沒有文字（空白不算）也沒有附件，就是空訊息。 */
export function isEmptyMessage(text: string, hasAttachment: boolean): boolean {
  return text.trim().length === 0 && !hasAttachment;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 今天的訊息只顯示時間；其他日子加上日期，例如「10/12 21:40」。 */
export function formatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}
