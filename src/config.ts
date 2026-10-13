import type { ChatBackend } from './backend/types';
import { MockBackend, type MockDebugControls } from './backend/mockBackend';

// 決定畫面要使用哪一個「資料層」。
// 階段一：永遠使用模擬版（不連任何伺服器，也沒有任何金鑰）。
// 階段二：在這裡改成「有設定 Supabase 網址與金鑰就用 supabaseBackend，沒有就用模擬版」，
//         畫面層的程式不需要改。
export const backend: ChatBackend = new MockBackend();

/** 只有模擬版才有測試控制。 */
export function getDebugControls(b: ChatBackend): MockDebugControls | null {
  return b instanceof MockBackend ? b : null;
}

export const debugEnabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
