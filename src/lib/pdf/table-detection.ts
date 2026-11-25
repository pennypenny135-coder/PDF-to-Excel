/**
 * 以座標對齊為基礎的啟發式表格偵測（無 AI、無向量線輔助）。
 * heuristicScore 只代表啟發式規則的符合程度，並非經驗證的準確率。
 */
import { MAX_TABLE_COLUMNS, TABLE_MIN_SCORE, TABLE_REVIEW_SCORE } from "../config";
import { clusterCells, joinItems, type LayoutBlock, type LayoutItem, type RowCell, type RowLine } from "./reading-order";

export interface DetectedTable {
  rows: string[][];
  rowCount: number;
  colCount: number;
  itemIds: string[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
  reasons: string[];
  warnings: string[];
  needsReview: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

interface Run {
  start: number;
  end: number; // inclusive
}

function findRuns(rows: RowLine[], cells: RowCell[][]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < rows.length) {
    if (cells[i].length < 2) {
      i++;
      continue;
    }
    let last = i; // 最後一個多儲存格列
    let j = i;
    while (j + 1 < rows.length) {
      const fs = (rows[j].h + rows[j + 1].h) / 2;
      if (rows[j + 1].cy - rows[j].cy > 3 * fs) break;
      if (cells[j + 1].length >= 2) {
        j++;
        last = j;
        continue;
      }
      // 單一儲存格列：最多容許連續 2 列，且其後必須緊接多儲存格列
      let k = j + 1;
      let found = -1;
      while (k < rows.length && k <= j + 2) {
        const f = (rows[k - 1].h + rows[k].h) / 2;
        if (rows[k].cy - rows[k - 1].cy > 3 * f) break;
        if (cells[k].length >= 2) {
          found = k;
          break;
        }
        k++;
      }
      if (found < 0) break;
      j = found;
      last = found;
    }
    if (last > i) runs.push({ start: i, end: last });
    i = last + 1;
  }
  return runs;
}

function evaluateRun(rows: RowLine[], cells: RowCell[][], run: Run): DetectedTable | null {
  const runRows = rows.slice(run.start, run.end + 1);
  const runCells = cells.slice(run.start, run.end + 1);
  const fs = median(runRows.map((r) => r.h)) || 10;
  const tolX = 0.3 * fs;
  const warnings: string[] = [];

  // 欄邊界：多儲存格列的 x 區間聯集
  const intervals: { s: number; e: number }[] = [];
  for (const rc of runCells) {
    if (rc.length >= 2) for (const c of rc) intervals.push({ s: c.x0, e: c.x1 });
  }
  intervals.sort((a, b) => a.s - b.s);
  const segs: { s: number; e: number }[] = [];
  for (const it of intervals) {
    const last = segs[segs.length - 1];
    if (last && it.s <= last.e + tolX) last.e = Math.max(last.e, it.e);
    else segs.push({ ...it });
  }
  const colCount = segs.length;
  if (colCount < 2 || colCount > MAX_TABLE_COLUMNS) return null;

  const assign = (c: RowCell): { col: number; spanning: boolean } => {
    let first = -1;
    let count = 0;
    for (let k = 0; k < segs.length; k++) {
      if (c.x0 <= segs[k].e + tolX && c.x1 >= segs[k].s - tolX) {
        if (first < 0) first = k;
        count++;
      }
    }
    if (first < 0) {
      // 不重疊任何欄：歸入最近的欄
      let best = 0;
      let bestD = Infinity;
      segs.forEach((sg, k) => {
        const d = Math.min(Math.abs(c.x0 - sg.e), Math.abs(c.x1 - sg.s));
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      return { col: best, spanning: false };
    }
    return { col: first, spanning: count > 1 };
  };

  const assignments = runCells.map((rc) => rc.map(assign));
  let spanningCount = 0;
  let sameColCount = 0;
  assignments.forEach((as) => {
    const seen = new Set<number>();
    as.forEach((a) => {
      if (a.spanning) spanningCount++;
      if (seen.has(a.col)) sameColCount++;
      seen.add(a.col);
    });
  });
  if (spanningCount > 0) {
    warnings.push(`有 ${spanningCount} 個儲存格橫跨多欄，無法可靠判斷合併儲存格，未合併，請核對。`);
  }
  if (sameColCount > 0) warnings.push(`有 ${sameColCount} 個儲存格內含多個分離片段，已合併在同一格。`);
  const singleRows = runCells.filter((rc) => rc.length < 2).length;
  if (singleRows > 0) warnings.push(`表格中夾有 ${singleRows} 列只有單一片段的列，請核對是否屬於表格。`);

  // 邏輯列：間距明顯較小且第一欄為空的行視為上一列的跨行內容
  const pitches: number[] = [];
  for (let r = 1; r < runRows.length; r++) pitches.push(runRows[r].cy - runRows[r - 1].cy);
  const medPitch = pitches.length >= 2 ? median(pitches) : 0;
  const logical: number[][] = []; // 每個邏輯列包含的 run 內列索引
  for (let r = 0; r < runRows.length; r++) {
    const hasCol0 = assignments[r].some((a) => a.col === 0);
    const isCont = r > 0 && medPitch > 0 && pitches[r - 1] < 0.75 * medPitch && !hasCol0 && logical.length > 0;
    if (isCont) logical[logical.length - 1].push(r);
    else logical.push([r]);
  }
  const mergedContinuations = runRows.length - logical.length;
  if (mergedContinuations > 0) {
    warnings.push(`有 ${mergedContinuations} 行被視為上一列的跨行內容，已用換行保留，請核對。`);
  }

  const tableRows: string[][] = logical.map((rIdxs) => {
    const row: string[] = new Array(colCount).fill("");
    for (let col = 0; col < colCount; col++) {
      const parts: string[] = [];
      for (const r of rIdxs) {
        const items: LayoutItem[] = [];
        runCells[r].forEach((c, ci) => {
          if (assignments[r][ci].col === col) items.push(...c.items);
        });
        if (items.length) parts.push(joinItems(items.sort((a, b) => a.x - b.x)));
      }
      row[col] = parts.join("\n");
    }
    return row;
  });

  // ---- 評分 ----
  const reasons: string[] = [];
  let score = 0;
  const multiRows = runCells.filter((rc) => rc.length >= 2);
  const nRows = tableRows.length;
  if (nRows >= 3) {
    score += 15;
    reasons.push(`連續 ${nRows} 列 (+15)`);
  } else {
    score += 5;
    reasons.push(`僅 ${nRows} 列 (+5)`);
  }
  if (colCount >= 3 && colCount <= 8) {
    score += 15;
    reasons.push(`${colCount} 欄，欄數合理 (+15)`);
  } else {
    score += 5;
    reasons.push(`${colCount} 欄 (+5)`);
  }
  const fills = multiRows.map((rc) => new Set(assignments[runCells.indexOf(rc)].map((a) => a.col)).size / colCount);
  const fill = mean(fills);
  if (fill >= 0.8) {
    score += 25;
    reasons.push(`各列欄位填充率 ${(fill * 100).toFixed(0)}%，欄數穩定 (+25)`);
  } else if (fill >= 0.6) {
    score += 15;
    reasons.push(`各列欄位填充率 ${(fill * 100).toFixed(0)}% (+15)`);
  } else {
    score += 5;
    reasons.push(`各列欄位填充率偏低 ${(fill * 100).toFixed(0)}% (+5)`);
  }
  // 對齊一致性：左／右／置中，取每欄最佳
  let alignedCells = 0;
  let totalCells = 0;
  for (let col = 0; col < colCount; col++) {
    const members: RowCell[] = [];
    runCells.forEach((rc, r) => rc.forEach((c, ci) => assignments[r][ci].col === col && members.push(c)));
    if (members.length === 0) continue;
    const mL = median(members.map((c) => c.x0));
    const mR = median(members.map((c) => c.x1));
    const mC = median(members.map((c) => (c.x0 + c.x1) / 2));
    const tol = 0.5 * fs;
    const l = members.filter((c) => Math.abs(c.x0 - mL) <= tol).length;
    const rr = members.filter((c) => Math.abs(c.x1 - mR) <= tol).length;
    const cc = members.filter((c) => Math.abs((c.x0 + c.x1) / 2 - mC) <= tol).length;
    alignedCells += Math.max(l, rr, cc);
    totalCells += members.length;
  }
  const align = totalCells ? alignedCells / totalCells : 0;
  if (align >= 0.8) {
    score += 25;
    reasons.push(`欄內對齊一致 ${(align * 100).toFixed(0)}% (+25)`);
  } else if (align >= 0.6) {
    score += 15;
    reasons.push(`欄內對齊尚可 ${(align * 100).toFixed(0)}% (+15)`);
  } else {
    reasons.push(`欄內對齊不一致 ${(align * 100).toFixed(0)}% (+0)`);
  }
  if (multiRows.length / runRows.length >= 0.8) {
    score += 10;
    reasons.push("多數列皆有多個儲存格 (+10)");
  }
  if (pitches.length >= 2) {
    const m = mean(pitches);
    const sd = Math.sqrt(mean(pitches.map((p) => (p - m) ** 2)));
    if (m > 0 && sd / m <= 0.35) {
      score += 10;
      reasons.push("列距規律 (+10)");
    }
  }
  const lens = tableRows.flat().filter(Boolean).map((t) => Array.from(t).length);
  const avgLen = mean(lens);
  const maxLen = lens.length ? Math.max(...lens) : 0;
  if (avgLen > 80) return null; // 太像整段正文，不當作表格
  if (avgLen > 50) {
    score -= 30;
    reasons.push(`儲存格平均長度 ${avgLen.toFixed(0)} 字，較像段落 (-30)`);
  } else if (maxLen > 200) {
    score -= 10;
    reasons.push(`含超長儲存格 (-10)`);
  }
  score = Math.max(0, Math.min(100, score));
  if (score < TABLE_MIN_SCORE) return null;

  const itemIds: string[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of runRows) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
    for (const it of r.items) itemIds.push(it.id);
  }
  const needsReview = score < TABLE_REVIEW_SCORE || warnings.length > 0 || nRows < 3;
  if (needsReview) warnings.unshift("需要核對：此表格為啟發式辨識，可能有欄位錯位或遺漏。");
  return { rows: tableRows, rowCount: nRows, colCount, itemIds, x0, y0, x1, y1, score, reasons, warnings, needsReview };
}

/** 在已排序的閱讀區塊中偵測表格；多欄文章的每一欄單獨偵測，不跨欄。 */
export function detectTables(blocks: LayoutBlock[]): DetectedTable[] {
  const tables: DetectedTable[] = [];
  for (const block of blocks) {
    if (block.kind === "span" || block.rows.length < 2) continue;
    const cells = block.rows.map((r) => clusterCells(r));
    for (const run of findRuns(block.rows, cells)) {
      const t = evaluateRun(block.rows, cells, run);
      if (t) tables.push(t);
    }
  }
  return tables;
}
