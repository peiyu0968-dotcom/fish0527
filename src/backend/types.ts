// 畫面層與資料層之間的「約定」（docs/architecture.md 第 5 節）。
// 畫面只認識這份介面；背後是模擬版還是 Supabase 版，畫面完全不知道。

export type MessageKind = 'chat' | 'join' | 'leave';

export interface Attachment {
  kind: 'image' | 'file';
  name: string;
  size: number;
  mime: string;
  /** 下載／顯示用的網址。模擬版重新整理後，非圖片檔案的網址會失效（空字串）。 */
  url: string;
  /** 檔案在儲存空間裡的路徑（只有 Supabase 版會有；送出訊息時要原樣帶回去）。 */
  path?: string;
}

export interface Message {
  id: number;
  kind: MessageKind;
  nickname: string;
  isMine: boolean;
  text: string;
  attachment: Attachment | null;
  createdAt: string; // ISO 時間
  edited: boolean;
  deleted: boolean;
  hidden: boolean;
}

export interface OnlineUser {
  nickname: string;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'failed';

export type ErrorCode =
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'NOT_JOINED'
  | 'EMPTY_MESSAGE'
  | 'RATE_LIMITED'
  | 'FILE_TOO_LARGE'
  | 'NOT_OWNER'
  | 'ALREADY_DELETED'
  | 'OWN_MESSAGE'
  | 'ALREADY_REPORTED'
  | 'NOT_FOUND'
  | 'MESSAGE_HIDDEN'
  | 'MESSAGE_TOO_LONG'
  | 'ATTACHMENT_INVALID'
  | 'NETWORK';

export class ChatError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatError';
    this.code = code;
  }
}

/** 畫面依 code 決定要顯示什麼提示，不依賴後端給的文字。 */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  NICKNAME_INVALID: '代號只能使用中文、英文、數字，最多 12 個字',
  NICKNAME_TAKEN: '這個代號已有人使用，請換一個',
  NOT_JOINED: '還沒進入聊天室，請重新進入',
  EMPTY_MESSAGE: '訊息不能是空的',
  RATE_LIMITED: '說話太快了，請稍等',
  FILE_TOO_LARGE: '檔案超過 10 MB 上限，無法傳送',
  NOT_OWNER: '只能修改自己的訊息',
  ALREADY_DELETED: '這則訊息已經刪除',
  OWN_MESSAGE: '不能檢舉自己的訊息',
  ALREADY_REPORTED: '你已經檢舉過這則訊息',
  NOT_FOUND: '找不到這則訊息',
  MESSAGE_HIDDEN: '這則訊息已被隱藏，無法修改',
  MESSAGE_TOO_LONG: '訊息太長了，請分成幾則送出',
  ATTACHMENT_INVALID: '附件無法使用，請重新選擇',
  NETWORK: '網路不穩，請稍後再試',
};

// ---- 事件（資料層 → 畫面層）----

export interface BackendEvents {
  'message.created': Message;
  'message.updated': Message;
  'presence.changed': OnlineUser[];
  'typing.started': string; // 輸入者的代號
  'connection.changed': ConnectionState;
  /** 在聊天室裡被迫離開（例如斷線太久、代號已被別人佔用），畫面要回到輸入代號並說明原因。 */
  'session.ended': { reason: ErrorCode };
}

export type EventName = keyof BackendEvents;
export type Unsubscribe = () => void;

// ---- 動作（畫面層 → 資料層）----

export interface SendMessageInput {
  text: string;
  attachment: Attachment | null;
}

export interface LoadHistoryInput {
  /** 只載入編號小於它的訊息；不給就是載入最新的。 */
  beforeId?: number;
  limit: number;
}

export interface HistoryPage {
  /** 舊的在前。 */
  messages: Message[];
  /** 再往前還有沒有更早的訊息。 */
  hasMore: boolean;
}

export interface ChatBackend {
  joinRoom(nickname: string): Promise<OnlineUser[]>;
  leaveRoom(): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<Message>;
  editMessage(id: number, text: string): Promise<Message>;
  deleteMessage(id: number): Promise<Message>;
  reportMessage(id: number): Promise<void>;
  loadHistory(input: LoadHistoryInput): Promise<HistoryPage>;
  /** 斷線重連後補漏：取得編號大於 afterId 的所有訊息（舊的在前）。 */
  loadSince(afterId: number): Promise<Message[]>;
  uploadFile(file: File, onProgress?: (percent: number) => void): Promise<Attachment>;
  notifyTyping(): void;
  retryConnection(): void;
  /** 網頁即將關閉時呼叫：同步、盡力通知「我要離開了」，不等結果。 */
  leaveOnPageHide(): void;
  subscribe<E extends EventName>(event: E, handler: (payload: BackendEvents[E]) => void): Unsubscribe;
}
