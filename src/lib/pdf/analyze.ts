/**
 * 版面分析主流程（純函式，可在 Web Worker 或主執行緒執行）：
 * 重疊文字層標記 → 依文字方向分組 → 閱讀順序 → 表格候選 → 頁面格線。
 * 原始片段永遠保留；此處只標註「歸屬」，不刪除任何片段。
 */
import type {
  BBox,
  FragmentSource,
  PageGrid,
  TableCandidate,
  TextFragment,
  TextLine,
  TextRotation,
} from "../types";
import { bboxIntersectionArea, bboxIoU, frameSize, toReadingFrame, unionBBox } from "./coordinates";
import { buildGrid } from "./page-grid";
import { readingOrder, type LayoutItem } from "./reading-order";
import { detectTables } from "./table-detection";

export interface AnalyzeInput {
  pageNumber: number;
  source: FragmentSource;
  width: number;
  height: number;
  fragments: TextFragment[];
  detectTables: boolean;
  buildGrid: boolean;
  /** 行號起點（補充來源接續主要來源之後） */
  firstLineNumber?: number;
  supplemental?: boolean;
}

export interface AnalyzeOutput {
  fragments: TextFragment[];
  lines: TextLine[];
  tables: TableCandidate[];
  grid: PageGrid | null;
  warnings: string[];
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

/** 以「文字 + bbox 重疊」標記同位置重複繪製的片段（例如假粗體、隱形文字層）。 */
function markOverlapDuplicates(frags: TextFragment[]): Set<string> {
  const excluded = new Set<string>();
  const byText = new Map<string, TextFragment[]>();
  for (const f of frags) {
    const key = f.text.trim();
    if (!key) continue;
    const list = byText.get(key);
    if (list) list.push(f);
    else byText.set(key, [f]);
  }
  for (const list of byText.values()) {
    if (list.length < 2) continue;
    const kept: TextFragment[] = [];
    for (const f of list) {
      let dup: TextFragment | null = null;
      let iou = 0;
      for (let i = kept.length - 1; i >= 0 && i >= kept.length - 50; i--) {
        const v = bboxIoU(f.bbox, kept[i].bbox);
        if (v > 0.8) {
          dup = kept[i];
          iou = v;
          break;
        }
      }
      if (dup) {
        excluded.add(f.id);
        f.warnings.push(
          `與片段 ${dup.id} 文字相同且位置重疊（IoU ${iou.toFixed(2)}），版面分析時視為重疊文字層而排除；原始片段已保留。`,
        );
      } else {
        kept.push(f);
      }
    }
  }
  return excluded;
}

export function analyzeFragments(input: AnalyzeInput): AnalyzeOutput {
  const { pageNumber, source, width, height } = input;
  const warnings: string[] = [];
  const frags: TextFragment[] = input.fragments.map((f) => ({
    ...f,
    bbox: { ...f.bbox },
    warnings: [...f.warnings],
    assignedLineId: null,
    assignedTableId: null,
  }));
  const byId = new Map(frags.map((f) => [f.id, f]));
  const excluded = markOverlapDuplicates(frags);
  const active = frags.filter((f) => !excluded.has(f.id) && f.text.trim().length > 0);

  // 依文字方向分組；主要方向（字元數最多者）優先
  const groups = new Map<TextRotation, TextFragment[]>();
  for (const f of active) {
    const list = groups.get(f.rotation);
    if (list) list.push(f);
    else groups.set(f.rotation, [f]);
  }
  const chars = (list: TextFragment[]) => list.reduce((n, f) => n + f.text.length, 0);
  const ordered = [...groups.entries()].sort((a, b) => chars(b[1]) - chars(a[1]));

  const lines: TextLine[] = [];
  const tables: TableCandidate[] = [];
  let lineNo = input.firstLineNumber ?? 1;
  let tableNo = 1;
  const prefix = `P${pad(pageNumber)}-${source === "native" ? "N" : "O"}`;
  let grid: PageGrid | null = null;
  const gridExtraRows: string[] = [];

  ordered.forEach(([rotation, list], groupIndex) => {
    const fsz = frameSize(rotation, width, height);
    const items: LayoutItem[] = list.map((f) => {
      const b = toReadingFrame(f.bbox, rotation, width, height);
      return { id: f.id, text: f.text, x: b.x, y: b.y, w: b.width, h: b.height };
    });
    if (rotation !== 0) {
      warnings.push(`偵測到 ${rotation}° 方向的文字（${list.length} 個片段），已在旋轉後的座標系中排序，請核對。`);
    }
    const ro = readingOrder(items);
    warnings.push(...ro.warnings);

    const groupLineTexts: string[] = [];
    for (const block of ro.blocks) {
      for (const row of block.rows) {
        const rowFrags = row.items.map((it) => byId.get(it.id)!).filter(Boolean);
        const confs = rowFrags.map((f) => f.confidence).filter((c): c is number => typeof c === "number");
        const id = `${prefix}L${lineNo}`;
        const text = row.text.replace(/\s+$/, "");
        lines.push({
          id,
          pageNumber,
          source,
          lineNumber: lineNo,
          text,
          fragmentIds: rowFrags.map((f) => f.id),
          bbox: unionBBox(rowFrags.map((f) => f.bbox)),
          columnIndex: block.columnIndex,
          supplemental: !!input.supplemental,
          confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
        });
        groupLineTexts.push(text);
        for (const f of rowFrags) f.assignedLineId = id;
        lineNo++;
      }
    }

    if (input.detectTables) {
      try {
        for (const t of detectTables(ro.blocks)) {
          const id = `P${pad(pageNumber)}-${source === "native" ? "N" : "O"}T${tableNo++}`;
          const tFrags = t.itemIds.map((i) => byId.get(i)!).filter(Boolean);
          for (const f of tFrags) f.assignedTableId = id;
          tables.push({
            id,
            pageNumber,
            source,
            rows: t.rows,
            rowCount: t.rowCount,
            colCount: t.colCount,
            bbox: unionBBox(tFrags.map((f) => f.bbox)),
            heuristicScore: t.score,
            scoreReasons: t.reasons,
            needsReview: t.needsReview,
            warnings: t.warnings,
            fragmentIds: tFrags.map((f) => f.id),
          });
        }
      } catch (e) {
        warnings.push(`表格偵測失敗（${e instanceof Error ? e.message : String(e)}）；全文、原始片段與頁面格線不受影響。`);
      }
    }

    if (input.buildGrid) {
      try {
        if (groupIndex === 0) {
          const g = buildGrid(items, fsz.width);
          grid = {
            pageNumber,
            source,
            rows: g.rows,
            colCount: g.colCount,
            fallbackLines: g.fallbackLines,
            warnings: g.warnings,
          };
        } else {
          gridExtraRows.push(...groupLineTexts);
        }
      } catch (e) {
        warnings.push(`頁面格線建立失敗（${e instanceof Error ? e.message : String(e)}）；全文與原始片段不受影響。`);
      }
    }
  });

  if (grid && gridExtraRows.length) {
    const g: PageGrid = grid;
    for (const t of gridExtraRows) {
      const row: string[] = new Array(Math.max(1, g.colCount)).fill("");
      row[0] = t;
      g.rows.push(row);
    }
    if (g.colCount === 0) g.colCount = 1;
    g.warnings.push("旋轉方向的文字以單一儲存格逐行附加在格線末端。");
  }

  return { fragments: frags, lines, tables, grid, warnings };
}

/**
 * 從「另一來源」的片段中挑出與主要來源不重疊者（以 bbox 判斷，不以字串去重）。
 * overlapped 者仍保留在原始片段，只是不再重複輸出到全文。
 */
export function splitSupplement(
  primary: TextFragment[],
  other: TextFragment[],
  overlapThreshold = 0.3,
): { keep: TextFragment[]; overlapped: TextFragment[] } {
  const BUCKET = 40;
  const buckets = new Map<number, BBox[]>();
  for (const p of primary) {
    const a = Math.floor(p.bbox.y / BUCKET);
    const b = Math.floor((p.bbox.y + p.bbox.height) / BUCKET);
    for (let k = a; k <= b; k++) {
      const list = buckets.get(k);
      if (list) list.push(p.bbox);
      else buckets.set(k, [p.bbox]);
    }
  }
  const keep: TextFragment[] = [];
  const overlapped: TextFragment[] = [];
  for (const o of other) {
    const area = o.bbox.width * o.bbox.height;
    let best = 0;
    if (area > 0) {
      const a = Math.floor(o.bbox.y / BUCKET);
      const b = Math.floor((o.bbox.y + o.bbox.height) / BUCKET);
      for (let k = a; k <= b; k++) {
        for (const pb of buckets.get(k) ?? []) {
          best = Math.max(best, bboxIntersectionArea(o.bbox, pb) / area);
        }
      }
    }
    if (best >= overlapThreshold) overlapped.push(o);
    else keep.push(o);
  }
  return { keep, overlapped };
}
