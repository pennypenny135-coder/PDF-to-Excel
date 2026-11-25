export interface PageRangeResult {
  /** 排序、去重、且在 1..totalPages 內的頁碼 */
  pages: number[];
  /** 格式錯誤（會使輸入無效） */
  errors: string[];
  /** 超出頁數範圍而被忽略的頁碼 */
  outOfRange: number[];
}

/** 解析 "1,3,5-8" 形式的頁碼。接受全形逗號、頓號、空白與各種破折號。 */
export function parsePageRanges(input: string, totalPages: number): PageRangeResult {
  const result: PageRangeResult = { pages: [], errors: [], outOfRange: [] };
  const trimmed = input.trim();
  if (!trimmed) {
    result.errors.push("請輸入頁碼，例如 1,3,5-8");
    return result;
  }
  const set = new Set<number>();
  const outOfRange = new Set<number>();
  const tokens = trimmed.split(/[,，、;\s]+/).filter(Boolean);

  for (const token of tokens) {
    const range = /^(\d+)\s*[-–—~～]\s*(\d+)$/.exec(token);
    const single = /^(\d+)$/.exec(token);
    let start: number;
    let end: number;
    if (single) {
      start = end = Number(single[1]);
    } else if (range) {
      start = Number(range[1]);
      end = Number(range[2]);
    } else {
      result.errors.push(`無法解析「${token}」`);
      continue;
    }
    if (start < 1 || end < 1) {
      result.errors.push(`頁碼必須從 1 開始：「${token}」`);
      continue;
    }
    if (start > end) {
      result.errors.push(`範圍起點大於終點：「${token}」`);
      continue;
    }
    for (let p = start; p <= Math.min(end, totalPages); p++) set.add(p);
    // 超出頁數的部分只記錄前 1000 個，避免 1-99999999 產生巨量集合
    for (let p = Math.max(start, totalPages + 1); p <= end && outOfRange.size < 1000; p++) outOfRange.add(p);
  }
  result.pages = [...set].sort((a, b) => a - b);
  result.outOfRange = [...outOfRange].sort((a, b) => a - b);
  return result;
}
