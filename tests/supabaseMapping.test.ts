import { describe, expect, it } from 'vitest';
import { rowToMessage, toChatError, type MessageRow } from '../src/backend/supabaseBackend/mapping';
import { ChatError } from '../src/backend/types';

const urlFor = (path: string, name: string, kind: 'image' | 'file') => `https://cdn.test/${path}${kind === 'file' ? `?download=${name}` : ''}`;

const base: MessageRow = {
  id: 7,
  kind: 'chat',
  author_id: 'user-1',
  nickname: '波波',
  content: '哈囉',
  attachment: null,
  created_at: '2026-10-13T14:32:08Z',
  edited_at: null,
  deleted_at: null,
  hidden: false,
};

describe('資料列轉訊息', () => {
  it('是自己送的就標記 isMine，別人的不是', () => {
    expect(rowToMessage(base, 'user-1', urlFor).isMine).toBe(true);
    expect(rowToMessage(base, 'user-2', urlFor).isMine).toBe(false);
    expect(rowToMessage(base, null, urlFor).isMine).toBe(false);
  });

  it('一般欄位原樣轉換', () => {
    expect(rowToMessage(base, 'user-2', urlFor)).toMatchObject({
      id: 7,
      kind: 'chat',
      nickname: '波波',
      text: '哈囉',
      attachment: null,
      createdAt: '2026-10-13T14:32:08Z',
      edited: false,
      deleted: false,
      hidden: false,
    });
  });

  it('有編輯時間就是已編輯；已刪除則不算已編輯', () => {
    expect(rowToMessage({ ...base, edited_at: '2026-10-13T15:00:00Z' }, null, urlFor).edited).toBe(true);
    const deleted = rowToMessage({ ...base, edited_at: '2026-10-13T15:00:00Z', deleted_at: '2026-10-13T16:00:00Z' }, null, urlFor);
    expect(deleted).toMatchObject({ edited: false, deleted: true, text: '' });
  });

  it('已隱藏的訊息看不到文字與附件', () => {
    const att = { kind: 'image' as const, name: 'a.jpg', size: 1, mime: 'image/jpeg', path: 'u/x' };
    const hidden = rowToMessage({ ...base, hidden: true, attachment: att }, null, urlFor);
    expect(hidden).toMatchObject({ hidden: true, text: '', attachment: null });
  });

  it('附件會換成可用的網址，檔案另外帶下載檔名', () => {
    const image = rowToMessage(
      { ...base, attachment: { kind: 'image', name: '貓咪.jpg', size: 482113, mime: 'image/jpeg', path: 'u/abc' } },
      null,
      urlFor,
    );
    expect(image.attachment).toMatchObject({ kind: 'image', name: '貓咪.jpg', url: 'https://cdn.test/u/abc', path: 'u/abc' });

    const file = rowToMessage(
      { ...base, attachment: { kind: 'file', name: 'a.pdf', size: 10, mime: 'application/pdf', path: 'u/def' } },
      null,
      urlFor,
    );
    expect(file.attachment?.url).toBe('https://cdn.test/u/def?download=a.pdf');
  });

  it('系統訊息（進入／離開）', () => {
    const join = rowToMessage({ ...base, kind: 'join', content: '' }, null, urlFor);
    expect(join).toMatchObject({ kind: 'join', text: '' });
  });
});

describe('錯誤轉換', () => {
  it('資料庫函式回報的代碼轉成同名的 ChatError', () => {
    for (const code of ['NICKNAME_TAKEN', 'NICKNAME_INVALID', 'RATE_LIMITED', 'NOT_OWNER', 'EMPTY_MESSAGE', 'NOT_JOINED', 'ALREADY_REPORTED', 'OWN_MESSAGE']) {
      const e = toChatError({ message: code, code: 'P0001' });
      expect(e).toBeInstanceOf(ChatError);
      expect(e.code).toBe(code);
    }
  });

  it('不認得的錯誤、網路錯誤都當成 NETWORK', () => {
    expect(toChatError({ message: 'TypeError: Failed to fetch' }).code).toBe('NETWORK');
    expect(toChatError(new Error('boom')).code).toBe('NETWORK');
    expect(toChatError(null).code).toBe('NETWORK');
    expect(toChatError('字串').code).toBe('NETWORK');
  });

  it('儲存空間回報檔案太大 → FILE_TOO_LARGE', () => {
    expect(toChatError({ message: 'The object exceeded the maximum allowed size' }).code).toBe('FILE_TOO_LARGE');
  });

  it('本來就是 ChatError 就原樣回傳', () => {
    const original = new ChatError('RATE_LIMITED');
    expect(toChatError(original)).toBe(original);
  });
});
