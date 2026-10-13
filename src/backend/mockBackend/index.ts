// 階段一的「模擬版」資料層：完全在瀏覽器裡運作，不連任何伺服器。
//  - 訊息存在 localStorage，重新整理後歷史還在。
//  - 有幾個「機器人」會定時說話、進出、輸入，讓你看到別人的訊息。
//  - 同一個瀏覽器開兩個分頁，會透過 BroadcastChannel 互相收到訊息。
//  - 規則（代號、空訊息、洗版限制、檢舉門檻）與階段二的資料庫函式一致。
import { Emitter } from '../emitter';
import {
  ChatError,
  type Attachment,
  type BackendEvents,
  type ChatBackend,
  type ConnectionState,
  type EventName,
  type HistoryPage,
  type LoadHistoryInput,
  type Message,
  type OnlineUser,
  type SendMessageInput,
  type Unsubscribe,
} from '../types';
import { checkNickname } from '../../rules/nickname';
import {
  MAX_FILE_BYTES,
  RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW_MS,
  isEmptyMessage,
} from '../../rules/message';
import {
  BOT_LINES,
  BOT_NAMES,
  BOT_REPLIES,
  BOTS_ONLINE_AT_START,
  buildSeed,
  type MockRecord,
  type MockState,
} from './seed';

const STORAGE_KEY = 'chat.mock.v1';
const CHANNEL_NAME = 'chat-mock-room';
const BOT_LEADER_KEY = 'chat.mock.botLeader';
const REPORT_THRESHOLD = 3;
const FAIL_AFTER_MS = 30_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface MockOptions {
  /** 預設用 localStorage；傳 null 代表只放記憶體（測試用）。 */
  storage?: StorageLike | null;
  /** 是否讓機器人自己說話（測試時關掉）。 */
  bots?: boolean;
  /** 是否啟用分頁間通訊。 */
  crossTab?: boolean;
  now?: () => number;
}

/** 只有 ?debug=1 時才會用到的測試控制。 */
export interface MockDebugControls {
  disconnect(autoRecoverMs: number | null): void;
  failConnection(): void;
  reconnect(): void;
  forceRateLimit(): void;
  botSay(): void;
  botReportLatest(): void;
  reset(): void;
}

type BroadcastMessage =
  | { t: 'changed'; id: number; key: string }
  | { t: 'hello'; key: string; nickname: string | null; reply?: boolean }
  | { t: 'bye'; key: string }
  | { t: 'typing'; key: string; nickname: string };

export class MockBackend implements ChatBackend, MockDebugControls {
  private readonly emitter = new Emitter();
  private readonly storage: StorageLike | null;
  private readonly useBots: boolean;
  private readonly now: () => number;
  private readonly clientKey = `tab:${Math.random().toString(36).slice(2, 10)}`;
  private channel: BroadcastChannel | null = null;

  private state: MockState;
  private nickname: string | null = null;
  private connection: ConnectionState = 'connected';
  private onlineBots = new Set<string>(BOTS_ONLINE_AT_START);
  private remoteUsers = new Map<string, string>(); // 其他分頁的 key → 代號
  private sentAt: number[] = [];
  private rateLimitOnce = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: MockOptions = {}) {
    this.storage = options.storage === undefined ? safeLocalStorage() : options.storage;
    this.useBots = options.bots ?? true;
    this.now = options.now ?? (() => Date.now());
    this.state = this.loadState();

    if (options.crossTab ?? typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (e: MessageEvent<BroadcastMessage>) => this.onRemote(e.data);
    }
  }

  // ---------- ChatBackend ----------

  subscribe<E extends EventName>(event: E, handler: (payload: BackendEvents[E]) => void): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  async joinRoom(nickname: string): Promise<OnlineUser[]> {
    await this.delay(250);
    this.assertConnected();
    if (checkNickname(nickname) !== 'ok') throw new ChatError('NICKNAME_INVALID');
    const lower = nickname.toLowerCase();
    const takenByBot = this.onlineBots.has(nickname) || [...this.onlineBots].some((b) => b.toLowerCase() === lower);
    const takenByTab = [...this.remoteUsers.values()].some((n) => n.toLowerCase() === lower);
    const mine = this.nickname?.toLowerCase() === lower;
    if ((takenByBot || takenByTab) && !mine) throw new ChatError('NICKNAME_TAKEN');

    if (this.nickname === null) {
      this.nickname = nickname;
      this.addRecord({ kind: 'join', authorKey: this.clientKey, nickname });
    } else if (this.nickname !== nickname) {
      this.nickname = nickname;
    }
    this.channel?.postMessage({ t: 'hello', key: this.clientKey, nickname } satisfies BroadcastMessage);
    this.startBots();
    this.emitPresence();
    return this.onlineUsers();
  }

  async leaveRoom(): Promise<void> {
    if (this.nickname === null) return;
    const nickname = this.nickname;
    this.nickname = null;
    this.addRecord({ kind: 'leave', authorKey: this.clientKey, nickname });
    this.channel?.postMessage({ t: 'bye', key: this.clientKey } satisfies BroadcastMessage);
    this.stopBots();
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    await this.delay(120);
    this.assertConnected();
    if (this.nickname === null) throw new ChatError('NOT_JOINED');
    if (isEmptyMessage(input.text, input.attachment !== null)) throw new ChatError('EMPTY_MESSAGE');

    const t = this.now();
    this.sentAt = this.sentAt.filter((s) => t - s < RATE_LIMIT_WINDOW_MS);
    if (this.rateLimitOnce || this.sentAt.length >= RATE_LIMIT_COUNT) {
      this.rateLimitOnce = false;
      throw new ChatError('RATE_LIMITED');
    }
    this.sentAt.push(t);

    const rec = this.addRecord({
      kind: 'chat',
      authorKey: this.clientKey,
      nickname: this.nickname,
      text: input.text,
      attachment: input.attachment,
    });
    this.scheduleBotReply();
    return this.toMessage(rec);
  }

  async editMessage(id: number, text: string): Promise<Message> {
    await this.delay(120);
    this.assertConnected();
    const rec = this.requireRecord(id);
    if (rec.authorKey !== this.clientKey) throw new ChatError('NOT_OWNER');
    if (rec.deleted) throw new ChatError('ALREADY_DELETED');
    if (isEmptyMessage(text, rec.attachment !== null)) throw new ChatError('EMPTY_MESSAGE');
    return this.toMessage(this.updateRecord(id, (r) => {
      r.text = text;
      r.editedAt = new Date(this.now()).toISOString();
    }));
  }

  async deleteMessage(id: number): Promise<Message> {
    await this.delay(120);
    this.assertConnected();
    const rec = this.requireRecord(id);
    if (rec.authorKey !== this.clientKey) throw new ChatError('NOT_OWNER');
    return this.toMessage(this.updateRecord(id, (r) => {
      r.deleted = true;
      r.text = '';
      r.attachment = null;
    }));
  }

  async reportMessage(id: number): Promise<void> {
    await this.delay(120);
    this.assertConnected();
    const rec = this.requireRecord(id);
    if (rec.authorKey === this.clientKey) throw new ChatError('OWN_MESSAGE');
    if (rec.reporters.includes(this.clientKey)) throw new ChatError('ALREADY_REPORTED');
    this.updateRecord(id, (r) => {
      r.reporters.push(this.clientKey);
      this.applyHideRule(r);
    });
  }

  async loadHistory({ beforeId, limit }: LoadHistoryInput): Promise<HistoryPage> {
    await this.delay(200);
    this.assertConnected();
    const pool = this.state.records.filter((r) => beforeId === undefined || r.id < beforeId);
    const slice = pool.slice(Math.max(0, pool.length - limit));
    return {
      messages: slice.map((r) => this.toMessage(r)),
      hasMore: pool.length > slice.length,
    };
  }

  async loadSince(afterId: number): Promise<Message[]> {
    await this.delay(150);
    this.reloadFromStorage();
    return this.state.records.filter((r) => r.id > afterId).map((r) => this.toMessage(r));
  }

  async uploadFile(file: File, onProgress?: (percent: number) => void): Promise<Attachment> {
    if (file.size > MAX_FILE_BYTES) throw new ChatError('FILE_TOO_LARGE');
    const steps = [10, 30, 55, 80, 100];
    for (const p of steps) {
      await this.delay(130);
      this.assertConnected();
      onProgress?.(p);
    }
    const isImage = file.type.startsWith('image/');
    const url = isImage ? await toThumbnailDataUrl(file) : objectUrl(file);
    return {
      kind: isImage ? 'image' : 'file',
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      url,
    };
  }

  notifyTyping(): void {
    if (this.nickname === null) return;
    this.channel?.postMessage({ t: 'typing', key: this.clientKey, nickname: this.nickname } satisfies BroadcastMessage);
  }

  retryConnection(): void {
    this.setConnection('reconnecting');
    this.later(1200, () => this.reconnect());
  }

  // ---------- 測試控制（?debug=1）----------

  disconnect(autoRecoverMs: number | null): void {
    this.setConnection('reconnecting');
    if (autoRecoverMs !== null) {
      this.later(autoRecoverMs, () => this.reconnect());
    } else {
      this.later(FAIL_AFTER_MS, () => {
        if (this.connection === 'reconnecting') this.setConnection('failed');
      });
    }
  }

  failConnection(): void {
    this.setConnection('failed');
  }

  reconnect(): void {
    if (this.connection === 'connected') return;
    this.setConnection('connected');
    this.emitPresence();
  }

  forceRateLimit(): void {
    this.rateLimitOnce = true;
  }

  botSay(): void {
    this.botSpeak();
  }

  /** 讓另外兩個機器人檢舉最新一則「別人的」訊息；你再檢舉一次就達到 3 人，會被自動隱藏。 */
  botReportLatest(): void {
    const target = [...this.state.records].reverse().find(
      (r) => r.kind === 'chat' && r.authorKey !== this.clientKey && !r.deleted && !r.hidden,
    );
    if (!target) return;
    this.updateRecord(target.id, (r) => {
      for (const name of ['bot:阿德', 'bot:Mia']) {
        if (!r.reporters.includes(name) && r.authorKey !== name) r.reporters.push(name);
      }
      this.applyHideRule(r);
    });
  }

  reset(): void {
    this.storage?.removeItem(STORAGE_KEY);
    this.state = buildSeed(this.now());
    this.saveState();
    window.location.reload();
  }

  dispose(): void {
    this.disposed = true;
    this.stopBots();
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.channel?.close();
  }

  // ---------- 內部：資料 ----------

  private loadState(): MockState {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MockState;
        if (parsed.v === 1 && Array.isArray(parsed.records)) return parsed;
      } catch {
        /* 壞掉的資料就重新產生 */
      }
    }
    const fresh = buildSeed(this.now());
    this.state = fresh;
    this.saveState();
    return fresh;
  }

  private reloadFromStorage(): void {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.v === 1 && Array.isArray(parsed.records)) this.state = parsed;
    } catch {
      /* 保留目前的記憶體資料 */
    }
  }

  private saveState(): void {
    if (!this.storage) return;
    const persist = (state: MockState) => {
      // blob: 網址只在目前分頁有效，存起來沒有意義。
      const clean: MockState = {
        ...state,
        records: state.records.map((r) =>
          r.attachment?.url.startsWith('blob:') ? { ...r, attachment: { ...r.attachment, url: '' } } : r,
        ),
      };
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(clean));
    };
    try {
      persist(this.state);
    } catch {
      // 空間不夠（圖片太多）：丟掉最舊的圖片內容再試一次。
      const trimmed: MockState = {
        ...this.state,
        records: this.state.records.map((r, i) =>
          i < this.state.records.length / 2 && r.attachment?.url.startsWith('data:')
            ? { ...r, attachment: { ...r.attachment, url: '' } }
            : r,
        ),
      };
      try {
        persist(trimmed);
        this.state = trimmed;
      } catch {
        /* 還是存不下就放棄，這次只留在記憶體 */
      }
    }
  }

  private addRecord(partial: Pick<MockRecord, 'kind' | 'authorKey' | 'nickname'> & Partial<MockRecord>): MockRecord {
    this.reloadFromStorage();
    const rec: MockRecord = {
      id: this.state.nextId,
      text: '',
      attachment: null,
      createdAt: new Date(this.now()).toISOString(),
      editedAt: null,
      deleted: false,
      hidden: false,
      approved: false,
      hiddenOriginal: null,
      reporters: [],
      ...partial,
    };
    this.state.nextId += 1;
    this.state.records.push(rec);
    this.saveState();
    this.channel?.postMessage({ t: 'changed', id: rec.id, key: this.clientKey } satisfies BroadcastMessage);
    this.emitIfConnected('message.created', this.toMessage(rec));
    return rec;
  }

  private updateRecord(id: number, mutate: (r: MockRecord) => void): MockRecord {
    this.reloadFromStorage();
    const rec = this.requireRecord(id);
    mutate(rec);
    this.saveState();
    this.channel?.postMessage({ t: 'changed', id, key: this.clientKey } satisfies BroadcastMessage);
    this.emitIfConnected('message.updated', this.toMessage(rec));
    return rec;
  }

  private requireRecord(id: number): MockRecord {
    this.reloadFromStorage();
    const rec = this.state.records.find((r) => r.id === id);
    if (!rec) throw new ChatError('NETWORK', 'message not found');
    return rec;
  }

  /** 3 個不同的人檢舉 → 隱藏（原文搬走，畫面讀不到）。 */
  private applyHideRule(r: MockRecord): void {
    if (r.hidden || r.approved || r.deleted) return;
    if (new Set(r.reporters).size >= REPORT_THRESHOLD) {
      r.hiddenOriginal = { text: r.text, attachment: r.attachment };
      r.hidden = true;
      r.text = '';
      r.attachment = null;
    }
  }

  private toMessage(r: MockRecord): Message {
    const covered = r.deleted || r.hidden;
    return {
      id: r.id,
      kind: r.kind,
      nickname: r.nickname,
      isMine: r.authorKey === this.clientKey,
      text: covered ? '' : r.text,
      attachment: covered ? null : r.attachment,
      createdAt: r.createdAt,
      edited: r.editedAt !== null && !r.deleted,
      deleted: r.deleted,
      hidden: r.hidden,
    };
  }

  // ---------- 內部：線上名單與連線 ----------

  private onlineUsers(): OnlineUser[] {
    const others = [...this.onlineBots, ...this.remoteUsers.values()];
    const list = this.nickname ? [this.nickname, ...others] : others;
    return list.map((nickname) => ({ nickname }));
  }

  private emitPresence(): void {
    this.emitIfConnected('presence.changed', this.onlineUsers());
  }

  private setConnection(next: ConnectionState): void {
    if (this.connection === next) return;
    this.connection = next;
    this.emitter.emit('connection.changed', next);
  }

  private assertConnected(): void {
    if (this.connection !== 'connected') throw new ChatError('NETWORK');
  }

  /** 斷線時不推送事件；重連後畫面會用 loadSince 補回漏掉的訊息。 */
  private emitIfConnected<E extends EventName>(event: E, payload: BackendEvents[E]): void {
    if (this.connection === 'connected') this.emitter.emit(event, payload);
  }

  private onRemote(data: BroadcastMessage): void {
    if (this.disposed || data.key === this.clientKey) return;
    switch (data.t) {
      case 'changed': {
        const before = this.state.records.some((r) => r.id === data.id);
        this.reloadFromStorage();
        const rec = this.state.records.find((r) => r.id === data.id);
        if (rec) this.emitIfConnected(before ? 'message.updated' : 'message.created', this.toMessage(rec));
        break;
      }
      case 'hello':
        if (data.nickname) this.remoteUsers.set(data.key, data.nickname);
        if (this.nickname && !data.reply) {
          this.channel?.postMessage({ t: 'hello', key: this.clientKey, nickname: this.nickname, reply: true } satisfies BroadcastMessage);
        }
        this.emitPresence();
        break;
      case 'bye':
        this.remoteUsers.delete(data.key);
        this.emitPresence();
        break;
      case 'typing':
        this.emitIfConnected('typing.started', data.nickname);
        break;
    }
  }

  // ---------- 內部：機器人 ----------

  private startBots(): void {
    if (!this.useBots || this.botTimer !== null || this.disposed) return;
    this.scheduleBotTick();
  }

  private stopBots(): void {
    if (this.botTimer !== null) clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  private scheduleBotTick(): void {
    const delay = 7000 + Math.random() * 11000;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.disposed || this.nickname === null) return;
      if (this.isBotLeader()) this.botAct();
      this.scheduleBotTick();
    }, delay);
  }

  /** 多個分頁同時開著時，只讓其中一個分頁驅動機器人，避免訊息變兩倍。 */
  private isBotLeader(): boolean {
    if (!this.storage) return true;
    const t = this.now();
    try {
      const raw = this.storage.getItem(BOT_LEADER_KEY);
      const lease = raw ? (JSON.parse(raw) as { key: string; until: number }) : null;
      if (lease && lease.key !== this.clientKey && lease.until > t) return false;
      this.storage.setItem(BOT_LEADER_KEY, JSON.stringify({ key: this.clientKey, until: t + 30_000 }));
    } catch {
      /* 讀不到就當自己是 leader */
    }
    return true;
  }

  private botAct(): void {
    const roll = Math.random();
    if (roll < 0.12) this.botToggle();
    else this.botSpeak();
  }

  private botSpeak(): void {
    const online = [...this.onlineBots];
    if (online.length === 0) return;
    const who = online[Math.floor(Math.random() * online.length)];
    // 先顯示「正在輸入」，過一下才送出訊息。
    this.emitIfConnected('typing.started', who);
    this.later(1800 + Math.random() * 1500, () => {
      if (!this.onlineBots.has(who)) return;
      this.addRecord({
        kind: 'chat',
        authorKey: `bot:${who}`,
        nickname: who,
        text: BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)],
      });
    });
  }

  private botToggle(): void {
    const names = [...BOT_NAMES];
    const who = names[Math.floor(Math.random() * names.length)];
    if (this.onlineBots.has(who)) {
      if (this.onlineBots.size <= 2) return;
      this.onlineBots.delete(who);
      this.addRecord({ kind: 'leave', authorKey: `bot:${who}`, nickname: who });
    } else {
      if (this.nickname?.toLowerCase() === who.toLowerCase()) return;
      this.onlineBots.add(who);
      this.addRecord({ kind: 'join', authorKey: `bot:${who}`, nickname: who });
    }
    this.emitPresence();
  }

  private scheduleBotReply(): void {
    if (!this.useBots || Math.random() > 0.6) return;
    const online = [...this.onlineBots];
    if (online.length === 0) return;
    const who = online[Math.floor(Math.random() * online.length)];
    this.later(1200, () => this.emitIfConnected('typing.started', who));
    this.later(3200 + Math.random() * 1500, () => {
      if (!this.onlineBots.has(who)) return;
      this.addRecord({
        kind: 'chat',
        authorKey: `bot:${who}`,
        nickname: who,
        text: BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)],
      });
    });
  }

  // ---------- 內部：工具 ----------

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.later(ms, resolve));
  }

  private later(ms: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(handle);
  }
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function objectUrl(file: File): string {
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
}

/** 圖片縮成最寬 800px 的 JPEG 小圖，這樣才存得進 localStorage，重新整理後還看得到。 */
async function toThumbnailDataUrl(file: File): Promise<string> {
  if (typeof document === 'undefined') return objectUrl(file);
  const source = objectUrl(file);
  if (!source) return '';
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = source;
    });
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(source);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return source;
  }
}
