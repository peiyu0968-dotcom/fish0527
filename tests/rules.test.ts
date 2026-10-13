import { describe, expect, it } from 'vitest';
import { checkNickname, nicknameColorIndex, nicknameLength } from '../src/rules/nickname';
import { linkify } from '../src/rules/linkify';
import { formatSize, formatTime, isEmptyMessage } from '../src/rules/message';

describe('代號規則', () => {
  it('中文、英文、數字可以，1–12 字', () => {
    expect(checkNickname('波波')).toBe('ok');
    expect(checkNickname('Mia88')).toBe('ok');
    expect(checkNickname('一二三四五六七八九十十一')).toBe('ok'); // 12 字
  });

  it('空白、符號、空格、表情符號、全形字、超過 12 字都不行', () => {
    expect(checkNickname('')).toBe('empty');
    expect(checkNickname('小明!')).toBe('bad_chars');
    expect(checkNickname('小 明')).toBe('bad_chars');
    expect(checkNickname('小明😀')).toBe('bad_chars');
    expect(checkNickname('ＡＢＣ')).toBe('bad_chars');
    expect(checkNickname('一二三四五六七八九十十一十二')).toBe('too_long'); // 13 字
  });

  it('字數以「字」計算', () => {
    expect(nicknameLength('波波')).toBe(2);
  });

  it('同一個代號永遠得到同一組顏色，且在 0–5 之間', () => {
    const a = nicknameColorIndex('小明');
    expect(nicknameColorIndex('小明')).toBe(a);
    for (const n of ['小明', 'Mia', '阿德', 'abc', '大雄']) {
      const i = nicknameColorIndex(n);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });
});

describe('網址轉連結', () => {
  it('http 與 https 網址變成連結', () => {
    expect(linkify('看這個 https://example.com/cats 超可愛')).toEqual([
      { type: 'text', value: '看這個 ' },
      { type: 'link', value: 'https://example.com/cats' },
      { type: 'text', value: ' 超可愛' },
    ]);
  });

  it('句尾標點不算在網址裡', () => {
    expect(linkify('去 https://example.com.')).toEqual([
      { type: 'text', value: '去 ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('javascript: 等假連結維持純文字', () => {
    expect(linkify('javascript:alert(1)')).toEqual([{ type: 'text', value: 'javascript:alert(1)' }]);
    expect(linkify('<a href="javascript:x">')).toEqual([{ type: 'text', value: '<a href="javascript:x">' }]);
  });

  it('只有 https:// 沒有網域，不算連結', () => {
    expect(linkify('https://')).toEqual([{ type: 'text', value: 'https://' }]);
  });
});

describe('訊息規則', () => {
  it('沒有文字也沒有附件就是空訊息', () => {
    expect(isEmptyMessage('', false)).toBe(true);
    expect(isEmptyMessage('   \n ', false)).toBe(true);
    expect(isEmptyMessage('', true)).toBe(false);
    expect(isEmptyMessage('hi', false)).toBe(false);
  });

  it('檔案大小格式', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(482113)).toBe('471 KB');
    expect(formatSize(2516582)).toBe('2.4 MB');
  });

  it('今天只顯示時間，其他日子加日期', () => {
    const now = new Date(2026, 9, 13, 15, 0);
    expect(formatTime(new Date(2026, 9, 13, 14, 32).toISOString(), now)).toBe('14:32');
    expect(formatTime(new Date(2026, 9, 12, 21, 40).toISOString(), now)).toBe('10/12 21:40');
  });
});
