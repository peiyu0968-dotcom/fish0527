import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Attachment,
  ChatBackend,
  ConnectionState,
  Message,
  OnlineUser,
} from '../backend/types';
import { HISTORY_PAGE_SIZE } from '../rules/message';

const TYPING_VISIBLE_MS = 3000;

/** 依訊息編號合併：同編號就更新，沒有就新增，並保持由舊到新。 */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;
  const byId = new Map<number, Message>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export interface ChatState {
  messages: Message[];
  online: OnlineUser[];
  typing: string[];
  connection: ConnectionState;
  hasMore: boolean;
  loadingInitial: boolean;
  loadingOlder: boolean;
  /** 別人送來的一般訊息累計數，給分頁標題的未讀數用。 */
  incomingCount: number;
  loadOlder: () => Promise<void>;
  send: (text: string, attachment: Attachment | null) => Promise<void>;
  edit: (id: number, text: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  report: (id: number) => Promise<void>;
  retry: () => void;
  notifyTyping: () => void;
}

export function useChat(backend: ChatBackend, nickname: string, initialOnline: OnlineUser[]): ChatState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<OnlineUser[]>(initialOnline);
  const [typing, setTyping] = useState<string[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connected');
  const [hasMore, setHasMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [incomingCount, setIncomingCount] = useState(0);

  const messagesRef = useRef<Message[]>([]);
  const connectionRef = useRef<ConnectionState>('connected');
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const loadingOlderRef = useRef(false);

  const apply = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const next = mergeMessages(current, incoming);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const clearTyping = useCallback((name: string) => {
    const timer = typingTimers.current.get(name);
    if (timer) clearTimeout(timer);
    typingTimers.current.delete(name);
    setTyping((names) => names.filter((n) => n !== name));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timers = typingTimers.current;

    const offCreated = backend.subscribe('message.created', (m) => {
      apply([m]);
      if (m.kind === 'chat' && !m.isMine) {
        setIncomingCount((n) => n + 1);
        clearTyping(m.nickname);
      }
    });
    const offUpdated = backend.subscribe('message.updated', (m) => apply([m]));
    const offPresence = backend.subscribe('presence.changed', setOnline);
    const offTyping = backend.subscribe('typing.started', (name) => {
      if (name === nickname) return;
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      timers.set(
        name,
        setTimeout(() => clearTyping(name), TYPING_VISIBLE_MS),
      );
      setTyping((names) => (names.includes(name) ? names : [...names, name]));
    });
    const offConnection = backend.subscribe('connection.changed', (state) => {
      const previous = connectionRef.current;
      connectionRef.current = state;
      setConnection(state);
      if (state === 'connected' && previous !== 'connected') {
        // 重連成功：用畫面上最後一則的編號，補上斷線期間漏掉的訊息。
        const lastId = messagesRef.current.reduce((max, m) => Math.max(max, m.id), 0);
        backend
          .loadSince(lastId)
          .then((missed) => {
            if (!cancelled) apply(missed);
          })
          .catch(() => {
            /* 補漏失敗時，下次事件或重連會再補 */
          });
      }
    });

    backend
      .loadHistory({ limit: HISTORY_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        apply(page.messages);
        setHasMore(page.hasMore);
        setLoadingInitial(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    return () => {
      cancelled = true;
      offCreated();
      offUpdated();
      offPresence();
      offTyping();
      offConnection();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [backend, nickname, apply, clearTyping]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await backend.loadHistory({ beforeId: oldest.id, limit: HISTORY_PAGE_SIZE });
      apply(page.messages);
      setHasMore(page.hasMore);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [backend, apply]);

  const send = useCallback(
    async (text: string, attachment: Attachment | null) => {
      const message = await backend.sendMessage({ text, attachment });
      apply([message]);
    },
    [backend, apply],
  );

  const edit = useCallback(
    async (id: number, text: string) => {
      apply([await backend.editMessage(id, text)]);
    },
    [backend, apply],
  );

  const remove = useCallback(
    async (id: number) => {
      apply([await backend.deleteMessage(id)]);
    },
    [backend, apply],
  );

  const report = useCallback((id: number) => backend.reportMessage(id), [backend]);
  const retry = useCallback(() => backend.retryConnection(), [backend]);
  const notifyTyping = useCallback(() => backend.notifyTyping(), [backend]);

  return {
    messages,
    online,
    typing,
    connection,
    hasMore,
    loadingInitial,
    loadingOlder,
    incomingCount,
    loadOlder,
    send,
    edit,
    remove,
    report,
    retry,
    notifyTyping,
  };
}
