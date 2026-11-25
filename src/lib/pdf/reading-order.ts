/**
 * 閱讀順序：行分組、行內拼接、多欄偵測。
 * 所有座標都是「閱讀座標系」（文字水平、由左至右、行由上而下）。
 */

export interface LayoutItem {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RowLine {
  items: LayoutItem[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cy: number;
  /** 平均字體高度 */
  h: number;
  text: string;
}

export type BlockKind = "full" | "column" | "span";

export interface LayoutBlock {
  kind: BlockKind;
  columnIndex: number;
  bandIndex: number;
  rows: RowLine[];
}

export interface ReadingOrderResult {
  blocks: LayoutBlock[];
  columnCount: number;
  warnings: string[];
}

const CJK_RE =
  /[\u1100-\u11ff\u2e80-\u303f\u3040-\u30ff\u3100-\u312f\u3130-\u318f\u31a0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

export function isCjkChar(ch: string | undefined): boolean {
  return !!ch && CJK_RE.test(ch);
}

function lastChar(s: string): string | undefined {
  const chars = Array.from(s);
  return chars[chars.length - 1];
}

function firstChar(s: string): string | undefined {
  return Array.from(s)[0];
}

/** 依實際間距拼接同一行內（已按 x 排序）的片段；中日韓字元之間不盲目加空格。 */
export function joinItems(items: LayoutItem[]): string {
  if (items.length === 0) return "";
  let out = items[0].text;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (/\s$/.test(out) || /^\s/.test(cur.text)) {
      out += cur.text;
      continue;
    }
    const gap = cur.x - (prev.x + prev.w);
    const fs = Math.max(1, (prev.h + cur.h) / 2);
    // 中日韓字元之間通常沒有空格（間距門檻較大）；與拉丁字母交界時以一般空格間距判斷
    const bothCjk = isCjkChar(lastChar(out)) && isCjkChar(firstChar(cur.text));
    const threshold = bothCjk ? 0.6 * fs : 0.2 * fs;
    if (gap > threshold) out += (gap > 3 * fs ? "  " : " ") + cur.text;
    else out += cur.text;
  }
  return out;
}

function buildRow(items: LayoutItem[]): RowLine {
  const sorted = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let hSum = 0;
  for (const it of sorted) {
    x0 = Math.min(x0, it.x);
    y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
    hSum += it.h;
  }
  return {
    items: sorted,
    x0,
    y0,
    x1,
    y1,
    cy: (y0 + y1) / 2,
    h: hSum / sorted.length,
    text: joinItems(sorted),
  };
}

/** 依 y 中心與字體高度容差分行，行由上而下，行內由左至右。 */
export function groupRows(items: LayoutItem[]): RowLine[] {
  const sorted = [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const groups: { items: LayoutItem[]; cySum: number; hSum: number }[] = [];
  for (const it of sorted) {
    const cy = it.y + it.h / 2;
    const last = groups[groups.length - 1];
    if (last) {
      const gcy = last.cySum / last.items.length;
      const gh = last.hSum / last.items.length;
      const tol = 0.5 * Math.max(1, Math.min(gh, it.h));
      if (Math.abs(cy - gcy) <= tol) {
        last.items.push(it);
        last.cySum += cy;
        last.hSum += it.h;
        continue;
      }
    }
    groups.push({ items: [it], cySum: cy, hSum: it.h });
  }
  return groups.map((g) => buildRow(g.items)).sort((a, b) => a.cy - b.cy);
}

/** 將一行拆成「儲存格」：相鄰片段間距小於門檻者合併。 */
export interface RowCell {
  x0: number;
  x1: number;
  items: LayoutItem[];
  text: string;
}

export function clusterCells(row: RowLine, gapFactor = 1.0): RowCell[] {
  const cells: RowCell[] = [];
  const gapMax = Math.max(gapFactor * row.h, 5);
  let current: LayoutItem[] = [];
  let curEnd = -Infinity;
  const flush = () => {
    if (current.length === 0) return;
    cells.push({
      x0: current[0].x,
      x1: Math.max(...current.map((i) => i.x + i.w)),
      items: current,
      text: joinItems(current),
    });
    current = [];
  };
  for (const it of row.items) {
    if (current.length > 0 && it.x - curEnd > gapMax) {
      flush();
      curEnd = -Infinity;
    }
    current.push(it);
    curEnd = Math.max(curEnd, it.x + it.w);
  }
  flush();
  return cells;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avgChars(rows: RowLine[]): number {
  if (rows.length === 0) return 0;
  let total = 0;
  for (const r of rows) total += Array.from(r.text.replace(/\s+/g, "")).length;
  return total / rows.length;
}

interface Gutter {
  x0: number;
  x1: number;
}

/**
 * 偵測欄間空白帶。條件保守：兩側都要有足夠的長文字行，才當作多欄文章；
 * 短儲存格組成的對齊（表格）不會被當成多欄。
 */
function detectGutters(items: LayoutItem[], warnings: string[]): Gutter[] {
  if (items.length < 12) return [];
  let cx0 = Infinity;
  let cx1 = -Infinity;
  for (const it of items) {
    cx0 = Math.min(cx0, it.x);
    cx1 = Math.max(cx1, it.x + it.w);
  }
  const contentW = cx1 - cx0;
  if (contentW <= 0) return [];
  const medFont = median(items.map((i) => i.h));
  const gapMin = Math.max(1.5 * medFont, contentW * 0.025, 8);
  const narrow = items.filter((i) => i.w < 0.6 * contentW);
  if (narrow.length < 12) return [];

  const sorted = [...narrow].sort((a, b) => a.x - b.x);
  const segments: { s: number; e: number }[] = [];
  for (const it of sorted) {
    const last = segments[segments.length - 1];
    if (last && it.x <= last.e) last.e = Math.max(last.e, it.x + it.w);
    else segments.push({ s: it.x, e: it.x + it.w });
  }

  const gutters: Gutter[] = [];
  let marginal = false;
  for (let i = 0; i < segments.length - 1; i++) {
    const g0 = segments[i].e;
    const g1 = segments[i + 1].s;
    if (g1 - g0 < gapMin) continue;
    const left = narrow.filter((it) => it.x + it.w <= g0 + 0.5);
    const right = narrow.filter((it) => it.x >= g1 - 0.5);
    const crossing = items.filter((it) => it.x < g1 && it.x + it.w > g0);
    if (crossing.length > Math.max(2, Math.ceil(0.12 * items.length))) continue;
    const leftRows = groupRows(left);
    const rightRows = groupRows(right);
    if (leftRows.length < 4 || rightRows.length < 4) continue;
    const lc = avgChars(leftRows);
    const rc = avgChars(rightRows);
    if (lc >= 15 && rc >= 15) gutters.push({ x0: g0, x1: g1 });
    else if (lc >= 8 && rc >= 8) marginal = true;
  }
  if (gutters.length === 0 && marginal) {
    warnings.push("頁面可能為多欄或表格版面，但無法可靠判斷；已按列由上而下閱讀，請核對座標與原始片段。");
  }
  return gutters.slice(0, 3);
}

export function readingOrder(items: LayoutItem[]): ReadingOrderResult {
  const warnings: string[] = [];
  if (items.length === 0) return { blocks: [], columnCount: 1, warnings };

  const gutters = detectGutters(items, warnings);
  if (gutters.length === 0) {
    return {
      blocks: [{ kind: "full", columnIndex: 0, bandIndex: 0, rows: groupRows(items) }],
      columnCount: 1,
      warnings,
    };
  }

  const crosses = (it: LayoutItem) => gutters.some((g) => it.x < g.x1 && it.x + it.w > g.x0);
  const spanning = items.filter(crosses);
  const normal = items.filter((it) => !crosses(it));
  const spanRows = groupRows(spanning);
  const columnOf = (it: LayoutItem) => {
    const cx = it.x + it.w / 2;
    let c = 0;
    for (const g of gutters) if (cx > (g.x0 + g.x1) / 2) c++;
    return c;
  };
  const bands: LayoutItem[][] = Array.from({ length: spanRows.length + 1 }, () => []);
  for (const it of normal) {
    const cy = it.y + it.h / 2;
    let b = 0;
    for (const sr of spanRows) if (sr.cy < cy) b++;
    bands[b].push(it);
  }

  const blocks: LayoutBlock[] = [];
  const columnCount = gutters.length + 1;
  for (let b = 0; b < bands.length; b++) {
    for (let c = 0; c < columnCount; c++) {
      const colItems = bands[b].filter((it) => columnOf(it) === c);
      if (colItems.length > 0) {
        blocks.push({ kind: "column", columnIndex: c, bandIndex: b, rows: groupRows(colItems) });
      }
    }
    if (b < spanRows.length) {
      blocks.push({ kind: "span", columnIndex: 0, bandIndex: b, rows: [spanRows[b]] });
    }
  }
  warnings.push(`偵測到 ${columnCount} 欄版面，已先按欄再按行閱讀（啟發式判斷，請核對）。`);
  return { blocks, columnCount, warnings };
}
