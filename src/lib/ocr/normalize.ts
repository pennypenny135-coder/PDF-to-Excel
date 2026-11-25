/**
 * 將 Tesseract.js 的輸出正規化為與原生文字相同的 TextFragment。
 * Tesseract.js 7 預設只回傳 text；必須明確要求 blocks（或 tsv）才有座標，
 * 因此這裡逐層防禦：blocks → tsv → 純文字，不假設 words 一定存在。
 */
import type { TextFragment } from "../types";

interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface OcrWord {
  text?: string;
  confidence?: number;
  bbox?: OcrBBox;
  font_name?: string;
}
interface OcrLine {
  text?: string;
  confidence?: number;
  bbox?: OcrBBox;
  words?: OcrWord[] | null;
}
interface OcrParagraph {
  lines?: OcrLine[] | null;
}
interface OcrBlock {
  paragraphs?: OcrParagraph[] | null;
}

/** 與 Tesseract.js RecognizeResult.data 相容的寬鬆輸入型別 */
export interface OcrPageData {
  text?: string | null;
  tsv?: string | null;
  blocks?: OcrBlock[] | null;
}

export interface NormalizeContext {
  pageNumber: number;
  /** 渲染縮放：canvas 像素 / 頁面座標 */
  renderScale: number;
  pageWidth: number;
  pageHeight: number;
}

export interface NormalizedOcr {
  fragments: TextFragment[];
  warnings: string[];
  granularity: "word" | "line" | "tsv-word" | "text-only" | "none";
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function validBox(b: OcrBBox | undefined): b is OcrBBox {
  return !!b && [b.x0, b.y0, b.x1, b.y1].every((v) => typeof v === "number" && Number.isFinite(v)) && b.x1 > b.x0 && b.y1 > b.y0;
}

export function normalizeOcrPage(data: OcrPageData, ctx: NormalizeContext): NormalizedOcr {
  const warnings: string[] = [];
  const out: TextFragment[] = [];
  const s = ctx.renderScale > 0 ? ctx.renderScale : 1;

  const push = (text: string, box: OcrBBox, confidence: number | null, extraWarnings: string[] = []) => {
    const x0 = Math.max(0, box.x0 / s);
    const y0 = Math.max(0, box.y0 / s);
    const x1 = Math.min(ctx.pageWidth, box.x1 / s);
    const y1 = Math.min(ctx.pageHeight, box.y1 / s);
    const index = out.length;
    out.push({
      id: `P${pad(ctx.pageNumber)}-O${index}`,
      pageNumber: ctx.pageNumber,
      source: "ocr",
      text,
      bbox: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) },
      rawIndex: index,
      fontName: null,
      fontSizeEstimate: y1 - y0 > 0 ? y1 - y0 : null,
      confidence,
      rotation: 0,
      assignedLineId: null,
      assignedTableId: null,
      warnings: ["OCR 結果，可能有誤。", ...extraWarnings],
    });
  };

  // 1) blocks → paragraphs → lines → words
  let granularity: NormalizedOcr["granularity"] = "none";
  if (Array.isArray(data.blocks)) {
    let usedLineFallback = false;
    for (const block of data.blocks) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          const words = (line.words ?? []).filter((w) => (w.text ?? "").trim().length > 0);
          const usable = words.filter((w) => validBox(w.bbox));
          if (usable.length > 0) {
            for (const w of usable) push((w.text ?? "").trim(), w.bbox as OcrBBox, finiteOrNull(w.confidence));
          } else if ((line.text ?? "").trim() && validBox(line.bbox)) {
            usedLineFallback = true;
            push((line.text ?? "").trim(), line.bbox, finiteOrNull(line.confidence), ["此行無字詞座標，以整行 bbox 輸出。"]);
          }
        }
      }
    }
    if (out.length > 0) granularity = usedLineFallback ? "line" : "word";
  }

  // 2) TSV（level 5 = word）
  if (out.length === 0 && typeof data.tsv === "string" && data.tsv.trim()) {
    const rows = data.tsv.split(/\r?\n/);
    for (const row of rows) {
      const c = row.split("\t");
      if (c.length < 12 || c[0] !== "5") continue;
      const left = Number(c[6]);
      const top = Number(c[7]);
      const w = Number(c[8]);
      const h = Number(c[9]);
      const conf = Number(c[10]);
      const text = c.slice(11).join("\t").trim();
      if (!text || ![left, top, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      push(text, { x0: left, y0: top, x1: left + w, y1: top + h }, Number.isFinite(conf) && conf >= 0 ? conf : null);
    }
    if (out.length > 0) {
      granularity = "tsv-word";
      warnings.push("OCR 引擎未提供 blocks，已改由 TSV 解析字詞座標。");
    }
  }

  // 3) 只有純文字：沒有座標，只能以等分高度排列，並明確標示
  if (out.length === 0 && typeof data.text === "string" && data.text.trim()) {
    const lines = data.text.split(/\r?\n/).filter((l) => l.trim());
    const lineH = ctx.pageHeight / Math.max(1, lines.length);
    lines.forEach((l, i) => {
      push(
        l.trim(),
        { x0: 0, y0: i * lineH * s, x1: ctx.pageWidth * s, y1: (i + 1) * lineH * s },
        null,
        ["OCR 引擎未提供座標，bbox 為依行序平均分配的近似值。"],
      );
    });
    granularity = "text-only";
    warnings.push("OCR 引擎未提供座標資料，僅取得純文字；bbox 為近似值，表格與版面還原不可靠。");
  }

  if (out.length === 0) warnings.push("OCR 沒有辨識出任何文字。");
  return { fragments: out, warnings, granularity };
}
