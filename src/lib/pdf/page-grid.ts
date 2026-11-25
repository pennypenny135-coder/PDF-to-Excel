/**
 * 逐頁近似格線：以 y 分行、以 x 聚類成欄。這只是位置的近似映射，並非 PDF 像素級還原。
 */
import { MAX_GRID_COLUMNS } from "../config";
import { clusterCells, groupRows, type LayoutItem } from "./reading-order";

export interface GridResult {
  rows: string[][];
  colCount: number;
  fallbackLines: boolean;
  warnings: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 以單連結方式對排序後的位置聚類：相鄰差距 ≤ tol 屬於同一欄。回傳每欄起點。 */
function clusterPositions(sortedPositions: number[], tol: number): number[] {
  const starts: number[] = [];
  let prev = -Infinity;
  for (const p of sortedPositions) {
    if (p - prev > tol) starts.push(p);
    prev = p;
  }
  return starts;
}

export function buildGrid(items: LayoutItem[], frameWidth: number): GridResult {
  const warnings: string[] = [];
  if (items.length === 0) return { rows: [], colCount: 0, fallbackLines: false, warnings };
  const rows = groupRows(items);
  const rowCells = rows.map((r) => ({ row: r, cells: clusterCells(r) }));
  const lefts = rowCells.flatMap((rc) => rc.cells.map((c) => c.x0)).sort((a, b) => a - b);
  const medFont = median(items.map((i) => i.h)) || 10;

  const tol = Math.max(1.5 * medFont, frameWidth * 0.012);
  let starts = clusterPositions(lefts, tol);

  const HARD_MERGE_LIMIT = 300;
  if (starts.length > MAX_GRID_COLUMNS && starts.length <= HARD_MERGE_LIMIT) {
    // 反覆合併間距最小的相鄰兩欄，直到欄數不超過上限
    const original = starts.length;
    while (starts.length > MAX_GRID_COLUMNS) {
      let best = 1;
      let bestGap = Infinity;
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      starts.splice(best, 1);
    }
    warnings.push(`偵測到 ${original} 欄，超過上限 ${MAX_GRID_COLUMNS}，已合併間距最小的相鄰欄；同格內容以空格串接。`);
  }

  if (starts.length > MAX_GRID_COLUMNS) {
    warnings.push(`欄數（${starts.length}）遠超過上限 ${MAX_GRID_COLUMNS}，此頁格線已退回逐行文字（單欄）。完整內容請見「全文」與「原始片段」。`);
    return {
      rows: rowCells.map((rc) => [rc.row.text]),
      colCount: 1,
      fallbackLines: true,
      warnings,
    };
  }

  const colOf = (x: number) => {
    let col = 0;
    for (let i = 0; i < starts.length; i++) if (x >= starts[i] - 1e-6) col = i;
    return col;
  };
  const grid = rowCells.map(({ cells }) => {
    const out: string[] = new Array(starts.length).fill("");
    for (const c of cells) {
      const col = colOf(c.x0);
      out[col] = out[col] ? `${out[col]} ${c.text}` : c.text;
    }
    return out;
  });
  return { rows: grid, colCount: starts.length, fallbackLines: false, warnings };
}
