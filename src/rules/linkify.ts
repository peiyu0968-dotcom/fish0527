// 把訊息裡的網址變成連結。只認 http:// 與 https:// 開頭的；
// javascript: 之類的假連結一律維持純文字。

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'　-〿＀-￯]+/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/;

export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = url.match(TRAILING_PUNCT)?.[0] ?? '';
    if (trailing) url = url.slice(0, url.length - trailing.length);
    if (/^https?:\/\/$/i.test(url)) continue; // 只有 "https://" 沒有網域，不算連結

    if (start > cursor) parts.push({ type: 'text', value: text.slice(cursor, start) });
    parts.push({ type: 'link', value: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts;
}
