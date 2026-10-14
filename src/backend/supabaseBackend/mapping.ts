// 把 Supabase 的資料列與錯誤，轉成畫面層認得的格式。純函式，不碰網路，方便測試。
import { ChatError, type Attachment, type ErrorCode, type Message } from '../types';

/** 資料庫 attachment 欄位裡存的格式（send_message 函式整理過的）。 */
export interface StoredAttachment {
  kind: 'image' | 'file';
  name: string;
  size: number;
  mime: string;
  path: string;
}

/** messages 資料表的一列。 */
export interface MessageRow {
  id: number;
  kind: 'chat' | 'join' | 'leave';
  author_id: string | null;
  nickname: string;
  content: string;
  attachment: StoredAttachment | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  hidden: boolean;
}

export type UrlFor = (path: string, name: string, kind: 'image' | 'file') => string;

export function rowToAttachment(stored: StoredAttachment, urlFor: UrlFor): Attachment {
  return {
    kind: stored.kind,
    name: stored.name,
    size: stored.size,
    mime: stored.mime,
    path: stored.path,
    url: urlFor(stored.path, stored.name, stored.kind),
  };
}

export function rowToMessage(row: MessageRow, myUserId: string | null, urlFor: UrlFor): Message {
  const covered = row.deleted_at !== null || row.hidden;
  return {
    id: row.id,
    kind: row.kind,
    nickname: row.nickname,
    isMine: myUserId !== null && row.author_id === myUserId,
    text: covered ? '' : row.content,
    attachment: covered || !row.attachment ? null : rowToAttachment(row.attachment, urlFor),
    createdAt: row.created_at,
    edited: row.edited_at !== null && row.deleted_at === null,
    deleted: row.deleted_at !== null,
    hidden: row.hidden,
  };
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'NICKNAME_INVALID',
  'NICKNAME_TAKEN',
  'NOT_JOINED',
  'EMPTY_MESSAGE',
  'RATE_LIMITED',
  'FILE_TOO_LARGE',
  'NOT_OWNER',
  'ALREADY_DELETED',
  'OWN_MESSAGE',
  'ALREADY_REPORTED',
  'NOT_FOUND',
  'MESSAGE_HIDDEN',
  'MESSAGE_TOO_LONG',
  'ATTACHMENT_INVALID',
  'NETWORK',
]);

/**
 * 資料庫函式用 `raise exception '錯誤代碼'` 回報失敗，代碼會原樣出現在 error.message。
 * 認得的就轉成同名的 ChatError；其他一律當成網路問題。
 */
export function toChatError(err: unknown): ChatError {
  if (err instanceof ChatError) return err;
  const message =
    typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : '';
  if (KNOWN_CODES.has(message)) return new ChatError(message as ErrorCode);
  // 檔案太大：Supabase 儲存空間自己擋下時的訊息
  if (/exceeded the maximum allowed size|payload too large|413/i.test(message)) return new ChatError('FILE_TOO_LARGE');
  return new ChatError('NETWORK', message || undefined);
}
