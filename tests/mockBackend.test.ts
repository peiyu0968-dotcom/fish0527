import { afterEach, describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mockBackend';
import { ChatError, type ErrorCode } from '../src/backend/types';

const made: MockBackend[] = [];
function make(): MockBackend {
  const b = new MockBackend({ storage: null, bots: false, crossTab: false });
  made.push(b);
  return b;
}
afterEach(() => {
  made.splice(0).forEach((b) => b.dispose());
});

async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
  await expect(promise).rejects.toMatchObject({ name: 'ChatError', code });
}

describe('進入與離開', () => {
  it('格式不對的代號被拒絕', async () => {
    await expectCode(make().joinRoom('小明!'), 'NICKNAME_INVALID');
    await expectCode(make().joinRoom(''), 'NICKNAME_INVALID');
  });

  it('跟線上的人同名（不分大小寫）會被擋', async () => {
    await expectCode(make().joinRoom('小明'), 'NICKNAME_TAKEN');
    await expectCode(make().joinRoom('mia'), 'NICKNAME_TAKEN');
  });

  it('成功進入後，名單有自己，且歷史裡有一則「進入」', async () => {
    const b = make();
    const online = await b.joinRoom('波波');
    expect(online.map((u) => u.nickname)).toContain('波波');
    const page = await b.loadHistory({ limit: 5 });
    const last = page.messages[page.messages.length - 1];
    expect(last).toMatchObject({ kind: 'join', nickname: '波波' });
  });

  it('離開後歷史裡多一則「離開」', async () => {
    const b = make();
    await b.joinRoom('波波');
    await b.leaveRoom();
    const page = await b.loadHistory({ limit: 1 });
    expect(page.messages[0]).toMatchObject({ kind: 'leave', nickname: '波波' });
  });
});

describe('送出訊息', () => {
  it('沒進入聊天室不能送', async () => {
    await expectCode(make().sendMessage({ text: 'hi', attachment: null }), 'NOT_JOINED');
  });

  it('空白訊息不能送', async () => {
    const b = make();
    await b.joinRoom('波波');
    await expectCode(b.sendMessage({ text: '   ', attachment: null }), 'EMPTY_MESSAGE');
  });

  it('送出的訊息標記為自己的，並透過事件通知', async () => {
    const b = make();
    await b.joinRoom('波波');
    const seen: number[] = [];
    b.subscribe('message.created', (m) => seen.push(m.id));
    const m = await b.sendMessage({ text: '哈囉', attachment: null });
    expect(m).toMatchObject({ isMine: true, nickname: '波波', text: '哈囉', kind: 'chat' });
    expect(seen).toContain(m.id);
  });

  it('10 秒內第 6 則會被擋', async () => {
    const b = make();
    await b.joinRoom('波波');
    for (let i = 0; i < 5; i += 1) await b.sendMessage({ text: `m${i}`, attachment: null });
    await expectCode(b.sendMessage({ text: 'm5', attachment: null }), 'RATE_LIMITED');
  });
});

describe('修改、刪除、檢舉', () => {
  it('只能改、刪自己的訊息；改過標示已編輯；刪除後內容清空', async () => {
    const b = make();
    await b.joinRoom('波波');
    const mine = await b.sendMessage({ text: '原本', attachment: null });
    const edited = await b.editMessage(mine.id, '改過');
    expect(edited).toMatchObject({ text: '改過', edited: true });
    const deleted = await b.deleteMessage(mine.id);
    expect(deleted).toMatchObject({ deleted: true, text: '' });
    await expectCode(b.editMessage(mine.id, '再改'), 'ALREADY_DELETED');

    const page = await b.loadHistory({ limit: 200 });
    const others = page.messages.find((m) => m.kind === 'chat' && !m.isMine && !m.deleted && !m.hidden);
    expect(others).toBeDefined();
    await expectCode(b.editMessage(others!.id, 'x'), 'NOT_OWNER');
    await expectCode(b.deleteMessage(others!.id), 'NOT_OWNER');
  });

  it('不能檢舉自己的訊息，也不能重複檢舉', async () => {
    const b = make();
    await b.joinRoom('波波');
    const mine = await b.sendMessage({ text: 'x', attachment: null });
    await expectCode(b.reportMessage(mine.id), 'OWN_MESSAGE');

    const page = await b.loadHistory({ limit: 200 });
    const target = page.messages.find((m) => m.kind === 'chat' && !m.isMine && !m.deleted && !m.hidden)!;
    await b.reportMessage(target.id);
    await expectCode(b.reportMessage(target.id), 'ALREADY_REPORTED');
  });

  it('3 個不同的人檢舉後訊息隱藏，內容讀不到', async () => {
    const b = make();
    await b.joinRoom('波波');
    const seen: boolean[] = [];
    b.subscribe('message.updated', (m) => seen.push(m.hidden));
    b.botReportLatest(); // 另外 2 位機器人檢舉最新一則別人的訊息
    const page = await b.loadHistory({ limit: 200 });
    const target = [...page.messages].reverse().find((m) => m.kind === 'chat' && !m.isMine && !m.deleted && !m.hidden)!;
    expect(target.hidden).toBe(false);
    await b.reportMessage(target.id); // 我是第 3 位
    const after = await b.loadHistory({ limit: 200 });
    const hidden = after.messages.find((m) => m.id === target.id)!;
    expect(hidden).toMatchObject({ hidden: true, text: '', attachment: null });
    expect(seen).toContain(true);
  });
});

describe('歷史與補漏', () => {
  it('一次載入一頁，往前載入不重複，載完 hasMore 為 false', async () => {
    const b = make();
    const first = await b.loadHistory({ limit: 50 });
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);

    let oldest = first.messages[0].id;
    let total = first.messages.length;
    let hasMore = first.hasMore;
    const ids = new Set(first.messages.map((m) => m.id));
    while (hasMore) {
      const page = await b.loadHistory({ beforeId: oldest, limit: 50 });
      for (const m of page.messages) {
        expect(ids.has(m.id)).toBe(false);
        ids.add(m.id);
      }
      total += page.messages.length;
      oldest = page.messages[0].id;
      hasMore = page.hasMore;
    }
    expect(total).toBeGreaterThan(100);
  });

  it('loadSince 只回傳編號比較大的訊息', async () => {
    const b = make();
    await b.joinRoom('波波');
    const m = await b.sendMessage({ text: 'a', attachment: null });
    const m2 = await b.sendMessage({ text: 'b', attachment: null });
    const missed = await b.loadSince(m.id);
    expect(missed.map((x) => x.id)).toEqual([m2.id]);
  });
});

describe('斷線', () => {
  it('斷線時送訊息會失敗，恢復後可以；連線狀態有通知', async () => {
    const b = make();
    await b.joinRoom('波波');
    const states: string[] = [];
    b.subscribe('connection.changed', (s) => states.push(s));
    b.disconnect(null);
    await expectCode(b.sendMessage({ text: 'x', attachment: null }), 'NETWORK');
    b.reconnect();
    await b.sendMessage({ text: 'x', attachment: null });
    expect(states).toEqual(['reconnecting', 'connected']);
  });
});

describe('檔案', () => {
  it('超過 10 MB 被拒絕', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.zip');
    await expectCode(make().uploadFile(big), 'FILE_TOO_LARGE');
  });

  it('一般檔案可以上傳，種類為 file', async () => {
    const f = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const att = await make().uploadFile(f);
    expect(att).toMatchObject({ kind: 'file', name: 'a.txt', size: 5 });
  });
});

describe('錯誤型別', () => {
  it('ChatError 帶有 code', () => {
    const e = new ChatError('RATE_LIMITED');
    expect(e.code).toBe('RATE_LIMITED');
  });
});
