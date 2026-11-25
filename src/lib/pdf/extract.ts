/**
 * 以 PDF.js getTextContent 抽取原生文字片段，並統一轉為 viewport 座標（左上角原點）。
 * 此模組不 import pdfjs-dist 的執行期程式碼，僅依賴傳入的 page 物件，方便在瀏覽器與 Node 測試共用。
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { SCAN_TEXT_CHAR_THRESHOLD, VECTOR_OPS_THRESHOLD } from "../config";
import type { TextFragment } from "../types";
import { textItemToViewportBox } from "./coordinates";

export interface NativeExtraction {
  width: number;
  height: number;
  pageRotation: number;
  fragments: TextFragment[];
  /** textContent.items 中的原始項目數（含空白項目） */
  rawItemCount: number;
  /** 非空白字元總數 */
  charCount: number;
  suspectedScanned: boolean;
  suspectedBlank: boolean;
  imageCount: number;
  warnings: string[];
}

const IMAGE_OP_NAMES = [
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintImageXObjectRepeat",
  "paintInlineImageXObjectGroup",
  "paintImageMaskXObjectGroup",
  "paintImageMaskXObjectRepeat",
  "paintJpegXObject",
];

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

export function countNonWhitespace(text: string): number {
  let n = 0;
  for (const ch of text) if (!/\s/.test(ch)) n++;
  return n;
}

export async function extractNativePage(
  page: PDFPageProxy,
  pageNumber: number,
  ops: Record<string, number>,
): Promise<NativeExtraction> {
  const viewport = page.getViewport({ scale: 1 });
  const warnings: string[] = [];
  const textContent = await page.getTextContent();
  const styles = (textContent.styles ?? {}) as Record<string, { fontFamily?: string }>;
  const fragments: TextFragment[] = [];
  let charCount = 0;

  textContent.items.forEach((item, index) => {
    if (!("str" in item)) return; // TextMarkedContent
    const text = item.str;
    if (!text || !text.trim()) return;
    const frag = textItemToViewportBox(item.transform, item.width, viewport.transform);
    const fragWarnings: string[] = [];
    let bbox = frag.bbox;
    if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
      bbox = { x: 0, y: 0, width: 0, height: 0 };
      fragWarnings.push("文字座標無法計算，bbox 已設為 0。");
    }
    charCount += countNonWhitespace(text);
    fragments.push({
      id: `P${pad(pageNumber)}-N${index}`,
      pageNumber,
      source: "native",
      text,
      bbox,
      rawIndex: index,
      fontName: styles[item.fontName]?.fontFamily || item.fontName || null,
      fontSizeEstimate: Number.isFinite(frag.fontSize) && frag.fontSize > 0 ? frag.fontSize : null,
      confidence: null,
      rotation: frag.rotation,
      assignedLineId: null,
      assignedTableId: null,
      warnings: fragWarnings,
    });
  });

  let imageCount = 0;
  let suspectedScanned = false;
  let suspectedBlank = false;
  if (charCount < SCAN_TEXT_CHAR_THRESHOLD) {
    // 只有在幾乎沒有文字時才檢查繪圖運算，避免為每頁付出額外成本
    try {
      const opList = await page.getOperatorList();
      const imageOps = new Set(IMAGE_OP_NAMES.map((n) => ops[n]).filter((v) => typeof v === "number"));
      for (const fn of opList.fnArray) if (imageOps.has(fn)) imageCount++;
      if (imageCount > 0) suspectedScanned = true;
      else if (opList.fnArray.length > VECTOR_OPS_THRESHOLD) suspectedScanned = true;
      else suspectedBlank = true;
    } catch (e) {
      warnings.push(`無法檢查頁面內容以判斷是否為掃描頁：${e instanceof Error ? e.message : String(e)}`);
      suspectedBlank = charCount === 0;
    }
    if (suspectedScanned && charCount === 0) {
      warnings.push(
        imageCount > 0
          ? "此頁沒有可抽取的文字層但含有圖片，疑似掃描頁（啟發式判斷，不能確定）。"
          : "此頁沒有可抽取的文字層但含有繪圖內容，可能是向量字形或掃描頁（啟發式判斷，不能確定）。",
      );
    }
  }

  return {
    width: viewport.width,
    height: viewport.height,
    pageRotation: page.rotate,
    fragments,
    rawItemCount: textContent.items.length,
    charCount,
    suspectedScanned,
    suspectedBlank,
    imageCount,
    warnings,
  };
}
