// 模擬版的假資料：機器人、聊天內容，以及一批預先放好的歷史訊息。
import type { Attachment } from '../types';

export const BOT_NAMES = ['小明', '阿德', 'Mia', '小美', '大雄'] as const;
/** 一開始就在線上的機器人（大雄一開始不在線，之後會進來）。 */
export const BOTS_ONLINE_AT_START = ['小明', '阿德', 'Mia', '小美'];

export const BOT_LINES = [
  '大家好～',
  '今天天氣好好',
  '有人在看比賽嗎？',
  '剛下班，終於可以休息了',
  '推薦一首歌：https://example.com/music',
  '哈哈哈哈這個太好笑了',
  '我剛剛看到一隻超可愛的貓',
  '週末有人想出去走走嗎？',
  '晚餐吃什麼好呢',
  '好喔！',
  '真的假的？',
  '我也這樣覺得',
  '等等再說',
  '午安～',
  '咖啡續杯中',
  '加油加油！',
];

export const BOT_REPLIES = ['收到！', '哈哈真的', '對啊對啊', '我也是！', '歡迎歡迎～', '好耶', '然後呢？', '讓我想一下'];

export interface MockRecord {
  id: number;
  kind: 'chat' | 'join' | 'leave';
  /** 誰送的：真人是各分頁自己的 key，機器人是 "bot:代號"。 */
  authorKey: string | null;
  nickname: string;
  text: string;
  attachment: Attachment | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  hidden: boolean;
  /** 管理者已確認過，不再被自動隱藏。 */
  approved: boolean;
  hiddenOriginal: { text: string; attachment: Attachment | null } | null;
  reporters: string[];
}

export interface MockState {
  v: 1;
  nextId: number;
  records: MockRecord[];
}

const SCENE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 128"><rect width="220" height="128" fill="#BFE3FF"/><circle cx="176" cy="32" r="18" fill="#FFC83D"/><ellipse cx="52" cy="30" rx="26" ry="9" fill="#fff"/><ellipse cx="72" cy="36" rx="20" ry="8" fill="#fff"/><path d="M0 128V88Q50 56 110 86T220 76V128Z" fill="#5ED3B0"/><path d="M0 128V108Q60 86 120 106T220 98V128Z" fill="#7B5CFA"/><circle cx="96" cy="96" r="10" fill="#FF8A5B"/><path d="M88 90 91 80 96 88M96 88 101 80 104 90" fill="#FF8A5B"/></svg>';

const DEMO_IMAGE: Attachment = {
  kind: 'image',
  name: '貓咪.jpg',
  size: 482113,
  mime: 'image/jpeg',
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SCENE_SVG)}`,
};

const DEMO_FILE: Attachment = {
  kind: 'file',
  name: '活動企劃.pdf',
  size: 2516582,
  mime: 'application/pdf',
  url: `data:text/plain;charset=utf-8,${encodeURIComponent('這是示範用的檔案內容。')}`,
};

/** 固定種子的亂數，讓每次產生的歷史都一樣。 */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 產生約 130 則、橫跨前兩天的歷史訊息，讓「往上捲載入更多」有東西可測。 */
export function buildSeed(nowMs: number): MockState {
  const rand = makeRandom(20261013);
  const records: MockRecord[] = [];
  let id = 1;
  const span = 44 * 60 * 60 * 1000; // 約兩天
  const start = nowMs - span;
  const total = 130;

  const push = (partial: Partial<MockRecord> & Pick<MockRecord, 'kind' | 'nickname'>, t: number) => {
    records.push({
      id: id++,
      authorKey: `bot:${partial.nickname}`,
      text: '',
      attachment: null,
      createdAt: new Date(t).toISOString(),
      editedAt: null,
      deleted: false,
      hidden: false,
      approved: false,
      hiddenOriginal: null,
      reporters: [],
      ...partial,
    });
  };

  for (let i = 0; i < total; i += 1) {
    // 越接近現在越密，且大致遞增。
    const t = start + (span * (i + rand() * 0.8)) / total;
    const who = BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)];

    if (i % 17 === 3) {
      push({ kind: 'join', nickname: who }, t);
    } else if (i % 17 === 11) {
      push({ kind: 'leave', nickname: who }, t);
    } else if (i === 40) {
      push({ kind: 'chat', nickname: 'Mia', text: '', attachment: DEMO_IMAGE }, t);
    } else if (i === 47) {
      push({ kind: 'chat', nickname: '阿德', text: '', attachment: DEMO_FILE }, t);
    } else if (i === 55) {
      push({ kind: 'chat', nickname: '小美', deleted: true }, t);
    } else if (i === 62) {
      push(
        {
          kind: 'chat',
          nickname: '小明',
          hidden: true,
          hiddenOriginal: { text: '（被檢舉的內容）', attachment: null },
          reporters: ['bot:阿德', 'bot:Mia', 'bot:小美'],
        },
        t,
      );
    } else if (i === 70) {
      push({ kind: 'chat', nickname: '阿德', text: '各位晚安，明天的聚會 7 點開始喔', editedAt: new Date(t + 60_000).toISOString() }, t);
    } else {
      push({ kind: 'chat', nickname: who, text: BOT_LINES[Math.floor(rand() * BOT_LINES.length)] }, t);
    }
  }

  return { v: 1, nextId: id, records };
}
