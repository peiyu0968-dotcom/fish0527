// 階段二的「Supabase 版」資料層。實作的是和模擬版同一份 ChatBackend 約定，畫面層完全不用改。
//
//  - 身分：匿名登入（使用者沒有感覺），瀏覽器記住身分。
//  - 所有寫入都呼叫資料庫函式（supabase/migrations/0002_functions.sql），規則在資料庫那邊強制執行。
//  - 即時推送：Realtime 訂閱 messages / online_users 的變動，加上「正在輸入」的廣播。
//  - 在線：每 15 秒呼叫一次 heartbeat；超過 45 秒沒心跳會被判定離線。
//  - 檔案：上傳到公開的 chat-files bucket，路徑是 {使用者編號}/{隨機碼}。
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
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
import { MAX_FILE_BYTES } from '../../rules/message';
import { checkNickname } from '../../rules/nickname';
import { rowToAttachment, rowToMessage, toChatError, type MessageRow, type StoredAttachment } from './mapping';

const BUCKET = 'chat-files';
const HEARTBEAT_MS = 15_000;
const FAIL_AFTER_MS = 30_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
// 只有這些點陣圖會直接顯示在對話裡；svg 等其他格式當成一般檔案，只提供下載。
const RASTER_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const MESSAGE_COLUMNS = 'id,kind,author_id,nickname,content,attachment,created_at,edited_at,deleted_at,hidden';

export class SupabaseBackend implements ChatBackend {
  private readonly client: SupabaseClient;
  private readonly emitter = new Emitter();
  private readonly url: string;
  private readonly key: string;

  private userId: string | null = null;
  private accessToken: string | null = null;
  private sessionPromise: Promise<string> | null = null;

  private nickname: string | null = null;
  private channel: RealtimeChannel | null = null;
  private connection: ConnectionState = 'connected';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private windowCleanup: (() => void) | null = null;

  constructor(url: string, publishableKey: string, options: { storageKey?: string } = {}) {
    this.url = url;
    this.key = publishableKey;
    this.client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: options.storageKey ?? 'chat.supabase.auth',
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      this.userId = session?.user.id ?? null;
      this.accessToken = session?.access_token ?? null;
    });
  }

  // ---------- ChatBackend ----------

  subscribe<E extends EventName>(event: E, handler: (payload: BackendEvents[E]) => void): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  async joinRoom(nickname: string): Promise<OnlineUser[]> {
    if (checkNickname(nickname) !== 'ok') throw new ChatError('NICKNAME_INVALID');
    await this.ensureUser();

    const { error } = await this.client.rpc('claim_nickname', { p_nickname: nickname });
    if (error) throw toChatError(error);
    this.nickname = nickname;

    try {
      await this.openChannel();
    } catch (err) {
      await this.client.rpc('leave_room');
      this.nickname = null;
      throw toChatError(err);
    }
    this.connection = 'connected';
    this.startHeartbeat();
    this.attachWindowListeners();
    return this.fetchOnline();
  }

  async leaveRoom(): Promise<void> {
    if (this.nickname === null) return;
    this.stopEverything();
    this.nickname = null;
    await this.client.rpc('leave_room');
  }

  leaveOnPageHide(): void {
    if (this.nickname === null || !this.accessToken) return;
    // 網頁關閉時一般的請求會被取消；keepalive 讓這個請求在頁面消失後仍會送出。
    fetch(`${this.url}/rest/v1/rpc/leave_room`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }).catch(() => {
      /* 送不出去也沒關係，45 秒後會被判定離線 */
    });
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    await this.ensureUser();
    let attachment: StoredAttachment | null = null;
    if (input.attachment) {
      if (!input.attachment.path) throw new ChatError('ATTACHMENT_INVALID');
      attachment = {
        kind: input.attachment.kind,
        name: input.attachment.name,
        size: input.attachment.size,
        mime: input.attachment.mime,
        path: input.attachment.path,
      };
    }
    const { data, error } = await this.client.rpc('send_message', {
      p_content: input.text,
      p_attachment: attachment,
    });
    if (error) throw toChatError(error);
    return this.toMessage(data as MessageRow);
  }

  async editMessage(id: number, text: string): Promise<Message> {
    await this.ensureUser();
    const { data, error } = await this.client.rpc('edit_message', { p_id: id, p_content: text });
    if (error) throw toChatError(error);
    return this.toMessage(data as MessageRow);
  }

  async deleteMessage(id: number): Promise<Message> {
    await this.ensureUser();
    const { data, error } = await this.client.rpc('delete_message', { p_id: id });
    if (error) throw toChatError(error);
    return this.toMessage(data as MessageRow);
  }

  async reportMessage(id: number): Promise<void> {
    await this.ensureUser();
    const { error } = await this.client.rpc('report_message', { p_id: id });
    if (error) throw toChatError(error);
  }

  async loadHistory({ beforeId, limit }: LoadHistoryInput): Promise<HistoryPage> {
    await this.ensureUser();
    let query = this.client
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (beforeId !== undefined) query = query.lt('id', beforeId);
    const { data, error } = await query;
    if (error) throw toChatError(error);

    const rows = (data ?? []) as unknown as MessageRow[];
    return {
      messages: rows
        .slice(0, limit)
        .reverse()
        .map((r) => this.toMessage(r)),
      hasMore: rows.length > limit,
    };
  }

  async loadSince(afterId: number): Promise<Message[]> {
    await this.ensureUser();
    const PAGE = 1000;
    const all: Message[] = [];
    let cursor = afterId;
    for (;;) {
      const { data, error } = await this.client
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .gt('id', cursor)
        .order('id', { ascending: true })
        .limit(PAGE);
      if (error) throw toChatError(error);
      const rows = (data ?? []) as unknown as MessageRow[];
      all.push(...rows.map((r) => this.toMessage(r)));
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1].id;
    }
    return all;
  }

  async uploadFile(file: File, onProgress?: (percent: number) => void): Promise<Attachment> {
    if (file.size > MAX_FILE_BYTES) throw new ChatError('FILE_TOO_LARGE');
    const uid = await this.ensureUser();
    const path = `${uid}/${crypto.randomUUID()}`;
    const isImage = RASTER_IMAGE.test(file.type);

    // 上傳套件不提供真正的進度，這裡用「慢慢往 90% 靠近」的方式讓使用者知道還在進行。
    let shown = 5;
    onProgress?.(shown);
    const ticker = setInterval(() => {
      shown = Math.min(90, shown + (90 - shown) * 0.15);
      onProgress?.(Math.round(shown));
    }, 200);

    try {
      // 非圖片一律包成「不可執行的二進位檔」，避免瀏覽器把 .html、.svg 之類的檔案當網頁打開。
      // （上傳套件會直接採用檔案本身的類型，所以要換一個 Blob，光設定選項沒有用。）
      const body = isImage ? file : new Blob([file], { type: 'application/octet-stream' });
      const { error } = await this.client.storage.from(BUCKET).upload(path, body, { upsert: false });
      if (error) throw toChatError(error);
    } finally {
      clearInterval(ticker);
    }
    onProgress?.(100);

    const kind = isImage ? 'image' : 'file';
    return rowToAttachment(
      { kind, name: file.name, size: file.size, mime: isImage ? file.type : 'application/octet-stream', path },
      this.urlFor,
    );
  }

  notifyTyping(): void {
    if (this.nickname === null || this.channel?.state !== 'joined') return;
    void this.channel.send({ type: 'broadcast', event: 'typing', payload: { nickname: this.nickname } });
  }

  retryConnection(): void {
    if (this.nickname === null) return;
    this.markReconnecting();
    void this.reopen();
  }

  // ---------- 內部：身分 ----------

  private async ensureUser(): Promise<string> {
    if (this.userId) return this.userId;
    this.sessionPromise ??= (async () => {
      const existing = await this.client.auth.getSession();
      if (existing.data.session) {
        this.userId = existing.data.session.user.id;
        this.accessToken = existing.data.session.access_token;
        return this.userId;
      }
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error || !data.user) throw new ChatError('NETWORK', error?.message ?? 'anonymous sign-in failed');
      this.userId = data.user.id;
      this.accessToken = data.session?.access_token ?? null;
      return this.userId;
    })();
    try {
      return await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      throw toChatError(err);
    }
  }

  // ---------- 內部：即時推送 ----------

  private openChannel(): Promise<void> {
    this.closeChannel();
    return new Promise<void>((resolve, reject) => {
      const channel = this.client.channel('room', { config: { broadcast: { self: false } } });
      this.channel = channel;

      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
          this.onMessageRow(p.new as MessageRow, 'message.created'),
        )
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) =>
          this.onMessageRow(p.new as MessageRow, 'message.updated'),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'online_users' }, () => this.scheduleOnlineRefresh())
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const name = (payload as { nickname?: unknown } | null)?.nickname;
          if (typeof name === 'string' && name !== this.nickname) this.emitter.emit('typing.started', name);
        });

      let first = true;
      const timeout = setTimeout(() => {
        if (!first) return;
        first = false;
        reject(new ChatError('NETWORK', 'realtime subscribe timeout'));
      }, SUBSCRIBE_TIMEOUT_MS);

      channel.subscribe((status) => {
        if (channel !== this.channel) return; // 已經被我們自己關掉的舊頻道
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          if (first) {
            first = false;
            resolve();
          } else {
            void this.onChannelRecovered();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (first) {
            first = false;
            clearTimeout(timeout);
            reject(new ChatError('NETWORK', status));
          } else {
            this.markReconnecting();
          }
        }
      });
    });
  }

  private closeChannel(): void {
    const old = this.channel;
    this.channel = null;
    if (old) void this.client.removeChannel(old);
  }

  private onMessageRow(row: MessageRow, event: 'message.created' | 'message.updated'): void {
    this.emitter.emit(event, this.toMessage(row));
  }

  private scheduleOnlineRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.fetchOnline().then((users) => this.emitter.emit('presence.changed', users)).catch(() => undefined);
    }, 200);
  }

  private async fetchOnline(): Promise<OnlineUser[]> {
    const { data, error } = await this.client.from('online_users').select('nickname').order('nickname');
    if (error) throw toChatError(error);
    return ((data ?? []) as { nickname: string }[]).map((r) => ({ nickname: r.nickname }));
  }

  // ---------- 內部：連線狀態 ----------

  private setConnection(next: ConnectionState): void {
    if (this.connection === next) return;
    this.connection = next;
    if (next === 'connected' && this.failTimer) {
      clearTimeout(this.failTimer);
      this.failTimer = null;
    }
    this.emitter.emit('connection.changed', next);
  }

  /** 進入「重新連線中」；30 秒內沒恢復就變成「無法連線」。 */
  private markReconnecting(): void {
    if (this.nickname === null) return;
    this.setConnection('reconnecting');
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = setTimeout(() => {
      this.failTimer = null;
      if (this.connection === 'reconnecting') this.setConnection('failed');
    }, FAIL_AFTER_MS);
  }

  private async onChannelRecovered(): Promise<void> {
    if (await this.verifyMembership()) {
      this.scheduleOnlineRefresh();
      this.setConnection('connected');
    }
  }

  private async reopen(): Promise<void> {
    try {
      await this.openChannel();
      if (await this.verifyMembership()) {
        this.scheduleOnlineRefresh();
        this.setConnection('connected');
      }
    } catch {
      /* 失敗就維持「重新連線中」，30 秒後會變成「無法連線」 */
    }
  }

  /**
   * 重連後確認自己還在線上名單裡。斷線超過 45 秒會被判定離線，這時重新佔用代號；
   * 如果代號已經被別人用了，就結束這次連線，請使用者換一個。
   */
  private async verifyMembership(): Promise<boolean> {
    if (this.nickname === null) return false;
    const beat = await this.client.rpc('heartbeat');
    if (!beat.error) return true;

    if (beat.error.message === 'NOT_JOINED') {
      const claim = await this.client.rpc('claim_nickname', { p_nickname: this.nickname });
      if (!claim.error) return true;
      if (claim.error.message === 'NICKNAME_TAKEN' || claim.error.message === 'NICKNAME_INVALID') {
        this.endSession('NICKNAME_TAKEN');
        return false;
      }
    }
    this.markReconnecting();
    return false;
  }

  private endSession(reason: 'NICKNAME_TAKEN'): void {
    this.stopEverything();
    this.nickname = null;
    this.emitter.emit('session.ended', { reason });
  }

  // ---------- 內部：心跳與瀏覽器事件 ----------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => void this.beat(), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async beat(): Promise<void> {
    if (this.nickname === null) return;
    const ok = await this.verifyMembership();
    // 心跳成功、即時頻道也正常，但畫面還顯示斷線（例如剛剛只是網路閃了一下）→ 恢復
    if (ok && this.connection !== 'connected' && this.channel?.state === 'joined') {
      this.scheduleOnlineRefresh();
      this.setConnection('connected');
    }
  }

  private attachWindowListeners(): void {
    this.windowCleanup?.();
    const onOnline = () => {
      if (this.connection !== 'connected') this.retryConnection();
    };
    const onOffline = () => this.markReconnecting();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.beat();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    this.windowCleanup = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  private stopEverything(): void {
    this.stopHeartbeat();
    if (this.failTimer) clearTimeout(this.failTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.failTimer = null;
    this.refreshTimer = null;
    this.windowCleanup?.();
    this.windowCleanup = null;
    this.closeChannel();
  }

  // ---------- 內部：轉換 ----------

  private readonly urlFor = (path: string, name: string, kind: 'image' | 'file'): string => {
    const { data } = this.client.storage.from(BUCKET).getPublicUrl(path, kind === 'file' ? { download: name } : undefined);
    return data.publicUrl;
  };

  private toMessage(row: MessageRow): Message {
    return rowToMessage(row, this.userId, this.urlFor);
  }
}
