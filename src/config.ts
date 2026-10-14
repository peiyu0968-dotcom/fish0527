import type { ChatBackend } from './backend/types';
import { MockBackend, type MockDebugControls } from './backend/mockBackend';
import { SupabaseBackend } from './backend/supabaseBackend';

// 決定畫面要使用哪一個「資料層」：
//  - 有設定 Supabase 的網址與可公開金鑰 → 用 Supabase 版（階段二，真人即時聊天）
//  - 沒有設定 → 用模擬版（階段一，只在自己的瀏覽器裡運作）
// 這兩個值放在 .env.local（本機）或 GitHub 的 Variables（上線），都是「可以公開」的值。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const backendKind: 'supabase' | 'mock' = supabaseUrl && supabaseKey ? 'supabase' : 'mock';

export const backend: ChatBackend =
  supabaseUrl && supabaseKey ? new SupabaseBackend(supabaseUrl, supabaseKey) : new MockBackend();

/** 只有模擬版才有測試控制。 */
export function getDebugControls(b: ChatBackend): MockDebugControls | null {
  return b instanceof MockBackend ? b : null;
}

export const debugEnabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
