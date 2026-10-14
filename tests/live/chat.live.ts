// 真的連到 Supabase 的完整測試（npm run test:live）。
// 用四個假身分（測試甲、乙、丙、丁）走過架構文件「階段二驗證清單」的主要項目。
// 會在資料庫留下測試用的訊息與一兩個小檔案；清理方式見 supabase/admin-snippets.sql 最後一段。
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseBackend } from '../../src/backend/supabaseBackend';
import type { BackendEvents, ChatBackend, ErrorCode, Message } from '../../src/backend/types';

// 這個測試在 Node 裡跑，沒有瀏覽器的 window / document，補上最小的假物件。
const noop = () => undefined;
Object.assign(globalThis, {
  window: { addEventListener: noop, removeEventListener: noop },
  document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' },
});

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const last = <T,>(list: T[]): T | undefined => list[list.length - 1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, probe: () => T | undefined | false, ms = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`逾時：${label}`);
    await sleep(100);
  }
}

async function expectCode(p: Promise<unknown>, code: ErrorCode) {
  await expect(p).rejects.toMatchObject({ name: 'ChatError', code });
}

interface Watcher {
  created: Message[];
  updated: Message[];
  presence: string[][];
  typing: string[];
  connection: string[];
  ended: unknown[];
}

function watch(b: ChatBackend): Watcher {
  const w: Watcher = { created: [], updated: [], presence: [], typing: [], connection: [], ended: [] };
  b.subscribe('message.created', (m) => w.created.push(m));
  b.subscribe('message.updated', (m) => w.updated.push(m));
  b.subscribe('presence.changed', (u) => w.presence.push(u.map((x) => x.nickname)));
  b.subscribe('typing.started', (n) => w.typing.push(n));
  b.subscribe('connection.changed', (s) => w.connection.push(s));
  b.subscribe('session.ended', (e: BackendEvents['session.ended']) => w.ended.push(e));
  return w;
}

const A = new SupabaseBackend(URL, KEY, { storageKey: 'live-a' });
const B = new SupabaseBackend(URL, KEY, { storageKey: 'live-b' });
const C = new SupabaseBackend(URL, KEY, { storageKey: 'live-c' });
const D = new SupabaseBackend(URL, KEY, { storageKey: 'live-d' });
let wB: Watcher;
let firstA: Message;
let hiddenTarget: Message;

beforeAll(() => {
  expect(URL, '缺少 VITE_SUPABASE_URL').toBeTruthy();
  expect(KEY, '缺少 VITE_SUPABASE_PUBLISHABLE_KEY').toBeTruthy();
});

afterAll(async () => {
  for (const b of [A, B, C, D]) {
    try {
      await b.leaveRoom();
    } catch {
      /* 清理用，忽略 */
    }
  }
});

describe('進入聊天室', () => {
  it('甲進入，名單有甲', async () => {
    const online = await A.joinRoom('測試甲');
    expect(online.map((u) => u.nickname)).toContain('測試甲');
  });

  it('乙想用同一個代號 → NICKNAME_TAKEN（大小寫不同也一樣）', async () => {
    await expectCode(B.joinRoom('測試甲'), 'NICKNAME_TAKEN');
  });

  it('不合法的代號被擋', async () => {
    await expectCode(B.joinRoom('測 試'), 'NICKNAME_INVALID');
    await expectCode(B.joinRoom('一二三四五六七八九十十一十二'), 'NICKNAME_INVALID');
  });

  it('乙用別的代號進入；甲即時看到名單變化與「進入」訊息', async () => {
    const wA = watch(A);
    const online = await B.joinRoom('測試乙');
    wB = watch(B);
    expect(online.map((u) => u.nickname)).toEqual(expect.arrayContaining(['測試甲', '測試乙']));
    await waitFor('甲看到名單有乙', () => wA.presence.some((p) => p.includes('測試乙')));
    await waitFor('甲看到乙進入的訊息', () => wA.created.find((m) => m.kind === 'join' && m.nickname === '測試乙'));
  });
});

describe('訊息', () => {
  it('甲送出，乙即時收到（不是自己的）', async () => {
    const t0 = Date.now();
    firstA = await A.sendMessage({ text: '你好，我是甲', attachment: null });
    expect(firstA).toMatchObject({ isMine: true, nickname: '測試甲', text: '你好，我是甲', kind: 'chat' });
    const got = await waitFor('乙收到甲的訊息', () => wB.created.find((m) => m.id === firstA.id));
    expect(got).toMatchObject({ isMine: false, text: '你好，我是甲' });
    console.log(`  即時延遲約 ${Date.now() - t0} ms`);
  });

  it('空白訊息被擋；沒進入聊天室不能送', async () => {
    await expectCode(A.sendMessage({ text: '   ', attachment: null }), 'EMPTY_MESSAGE');
    await expectCode(C.sendMessage({ text: 'x', attachment: null }), 'NOT_JOINED');
  });

  it('10 秒內第 6 則被擋，內容不會寫入', async () => {
    for (let i = 2; i <= 5; i += 1) await A.sendMessage({ text: `連發 ${i}`, attachment: null });
    await expectCode(A.sendMessage({ text: '連發 6', attachment: null }), 'RATE_LIMITED');
    const recent = await B.loadHistory({ limit: 20 });
    expect(recent.messages.some((m) => m.text === '連發 6')).toBe(false);
    await sleep(10_500); // 等限速的視窗過去
  });

  it('乙不能改、刪甲的訊息；甲改了之後乙即時看到「已編輯」', async () => {
    await expectCode(B.editMessage(firstA.id, 'hack'), 'NOT_OWNER');
    await expectCode(B.deleteMessage(firstA.id), 'NOT_OWNER');
    await A.editMessage(firstA.id, '你好，我是甲（改）');
    const upd = await waitFor('乙看到修改', () => wB.updated.find((m) => m.id === firstA.id && m.edited));
    expect(upd.text).toBe('你好，我是甲（改）');
  });

  it('甲刪除自己的訊息，乙即時看到「已刪除」，內容清空', async () => {
    const m = await A.sendMessage({ text: '待會刪掉', attachment: null });
    await A.deleteMessage(m.id);
    const upd = await waitFor('乙看到刪除', () => wB.updated.find((x) => x.id === m.id && x.deleted));
    expect(upd).toMatchObject({ text: '', deleted: true });
    await expectCode(A.editMessage(m.id, 'again'), 'ALREADY_DELETED');
  });

  it('「正在輸入」即時傳到乙', async () => {
    A.notifyTyping();
    await waitFor('乙收到輸入中', () => wB.typing.includes('測試甲'));
  });
});

describe('檢舉', () => {
  it('丙、丁進入', async () => {
    await C.joinRoom('測試丙');
    await D.joinRoom('測試丁');
  });

  it('不能檢舉自己；重複檢舉只算一次；3 個不同的人檢舉後隱藏，原文看不到', async () => {
    hiddenTarget = await A.sendMessage({ text: '這則會被檢舉', attachment: null });
    await expectCode(A.reportMessage(hiddenTarget.id), 'OWN_MESSAGE');
    await B.reportMessage(hiddenTarget.id);
    await expectCode(B.reportMessage(hiddenTarget.id), 'ALREADY_REPORTED');
    await C.reportMessage(hiddenTarget.id);
    await sleep(800);
    expect(wB.updated.some((m) => m.id === hiddenTarget.id && m.hidden)).toBe(false); // 2 人還沒隱藏
    await D.reportMessage(hiddenTarget.id);
    const hidden = await waitFor('乙看到隱藏', () => wB.updated.find((m) => m.id === hiddenTarget.id && m.hidden));
    expect(hidden).toMatchObject({ hidden: true, text: '', attachment: null });
    const again = (await B.loadHistory({ limit: 30 })).messages.find((m) => m.id === hiddenTarget.id);
    expect(again).toMatchObject({ hidden: true, text: '' });
    await expectCode(A.editMessage(hiddenTarget.id, 'x'), 'MESSAGE_HIDDEN');
  });
});

describe('檔案', () => {
  it('超過 10 MB：前端擋下；直接送給儲存空間也被擋', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.bin');
    await expectCode(A.uploadFile(big), 'FILE_TOO_LARGE');

    const raw = createClient(URL, KEY, { auth: { persistSession: false } });
    const { data } = await raw.auth.signInAnonymously();
    const { error } = await raw.storage.from('chat-files').upload(`${data.user!.id}/${crypto.randomUUID()}`, big);
    expect(error, '儲存空間應該拒絕超過 10 MB 的檔案').toBeTruthy();
  });

  it('不能上傳到別人的資料夾', async () => {
    const raw = createClient(URL, KEY, { auth: { persistSession: false } });
    await raw.auth.signInAnonymously();
    const { error } = await raw.storage.from('chat-files').upload(`00000000-0000-0000-0000-000000000000/${crypto.randomUUID()}`, new Blob(['x']));
    expect(error, '應該被拒絕').toBeTruthy();
  });

  it('不能把別人資料夾的路徑當附件送出', async () => {
    await expectCode(
      A.sendMessage({
        text: '',
        attachment: { kind: 'file', name: 'x', size: 1, mime: 'a/b', url: '', path: '00000000-0000-0000-0000-000000000000/123e4567-e89b-12d3-a456-426614174000' },
      }),
      'ATTACHMENT_INVALID',
    );
  });

  it('上傳一般檔案並送出：乙收到附件，下載內容正確，且不會被當網頁執行', async () => {
    const progress: number[] = [];
    const att = await A.uploadFile(new File(['hello 你好'], '測試.txt', { type: 'text/plain' }), (p) => progress.push(p));
    expect(att).toMatchObject({ kind: 'file', name: '測試.txt' });
    expect(last(progress)).toBe(100);
    const sent = await A.sendMessage({ text: '', attachment: att });
    const got = await waitFor('乙收到附件', () => wB.created.find((m) => m.id === sent.id));
    expect(got.attachment).toMatchObject({ kind: 'file', name: '測試.txt' });
    const res = await fetch(got.attachment!.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello 你好');
    expect(res.headers.get('content-type')).toMatch(/octet-stream/);
  });

  it('上傳圖片：種類是 image，網址能直接取得', async () => {
    // 1x1 的 PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const att = await A.uploadFile(new File([png], 'dot.png', { type: 'image/png' }));
    expect(att.kind).toBe('image');
    const res = await fetch(att.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/png/);
  });
});

describe('歷史與補漏', () => {
  it('分頁載入：一頁一頁往前，不重複', async () => {
    const first = await B.loadHistory({ limit: 5 });
    expect(first.messages).toHaveLength(5);
    expect(first.hasMore).toBe(true);
    const ids = first.messages.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const second = await B.loadHistory({ beforeId: ids[0], limit: 5 });
    expect(second.messages.every((m) => m.id < ids[0])).toBe(true);
  });

  it('補漏：只回傳編號比較大的訊息，並包含修改後的狀態', async () => {
    const all = await B.loadHistory({ limit: 200 });
    const cut = all.messages[all.messages.length - 4].id;
    const missed = await B.loadSince(cut);
    expect(missed.length).toBeGreaterThanOrEqual(3);
    expect(missed.every((m) => m.id > cut)).toBe(true);
  });
});

describe('離開與逾時', () => {
  it('甲離開：乙即時看到名單與「離開」訊息；代號立刻能被別人使用', async () => {
    await A.leaveRoom();
    await waitFor('乙看到名單沒有甲', () => last(wB.presence) && !last(wB.presence)!.includes('測試甲'));
    await waitFor('乙看到甲離開的訊息', () => wB.created.find((m) => m.kind === 'leave' && m.nickname === '測試甲'));
    const online = await A.joinRoom('測試甲'); // 甲自己再進來
    expect(online.map((u) => u.nickname)).toContain('測試甲');
    await A.leaveRoom();
    await C.leaveRoom();
    const online2 = await C.joinRoom('測試甲'); // 丙換用甲的代號
    expect(online2.map((u) => u.nickname)).toContain('測試甲');
  });

  it('丁沒有按離開就消失：約 45 秒後被判定離線，補上「離開」訊息', async () => {
    // 模擬「直接關掉網頁」：丁不再送心跳，也沒有通知離開
    (D as unknown as { stopEverything: () => void }).stopEverything();
    const t0 = Date.now();
    await waitFor(
      '乙看到丁被判定離線',
      () => wB.created.find((m) => m.kind === 'leave' && m.nickname === '測試丁'),
      90_000,
    );
    const seconds = Math.round((Date.now() - t0) / 1000);
    console.log(`  丁消失後 ${seconds} 秒被判定離線`);
    expect(seconds).toBeGreaterThanOrEqual(30);
    await waitFor('名單不再有丁', () => last(wB.presence) && !last(wB.presence)!.includes('測試丁'));
  });
});
