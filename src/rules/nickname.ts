// 代號規則：前端與（階段二的）資料庫共用同一條。
// 只允許半形英數與中文，1–12 字。全形字、符號、空白、表情符號都不行。

export const NICKNAME_MAX = 12;
export const NICKNAME_PATTERN = /^[A-Za-z0-9一-鿿]+$/;

export type NicknameCheck = 'ok' | 'empty' | 'too_long' | 'bad_chars';

export function checkNickname(raw: string): NicknameCheck {
  if (raw.length === 0) return 'empty';
  if ([...raw].length > NICKNAME_MAX) return 'too_long';
  if (!NICKNAME_PATTERN.test(raw)) return 'bad_chars';
  return 'ok';
}

export function nicknameLength(raw: string): number {
  return [...raw].length;
}

export const NICKNAME_PROBLEM_TEXT: Record<Exclude<NicknameCheck, 'ok'>, string> = {
  empty: '請輸入代號',
  too_long: `代號最多 ${NICKNAME_MAX} 個字`,
  bad_chars: '代號只能使用中文、英文、數字',
};

/** 每個人有 6 組專屬顏色之一；同一個代號在每個人的畫面上永遠同色。 */
export const PALETTE_SIZE = 6;

export function nicknameColorIndex(nickname: string): number {
  let hash = 0;
  for (const ch of nickname) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % PALETTE_SIZE;
}

export function nicknameInitial(nickname: string): string {
  const first = [...nickname][0] ?? '?';
  return first.toUpperCase();
}
