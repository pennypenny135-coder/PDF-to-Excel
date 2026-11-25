import type { PDFPageProxy } from "pdfjs-dist";
import { OCR_MAX_PIXELS, OCR_SCALE } from "../config";
import type { OcrQuality } from "../types";

export interface RenderedPage {
  blob: Blob;
  /** canvas 像素 / 頁面座標 */
  scale: number;
  release: () => void;
}

/** 計算 OCR 渲染縮放，限制總像素面積以避免記憶體耗盡。 */
export function computeOcrScale(pageWidth: number, pageHeight: number, quality: OcrQuality): number {
  let scale: number = OCR_SCALE[quality];
  const area = pageWidth * pageHeight * scale * scale;
  if (area > OCR_MAX_PIXELS) scale = Math.sqrt(OCR_MAX_PIXELS / (pageWidth * pageHeight));
  return scale;
}

/**
 * 以 PDF.js 將頁面渲染到 canvas，轉成 PNG Blob 供 OCR 使用（不會把 PDF bytes 交給 Tesseract）。
 * canvas 在轉換完成後立即歸零釋放。
 */
export async function renderPageForOcr(page: PDFPageProxy, quality: OcrQuality): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1 });
  const scale = computeOcrScale(base.width, base.height, quality);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const release = () => {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  };
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法建立 canvas，可能是記憶體不足或頁面過大。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas 轉換為圖片失敗，可能是記憶體不足。"))),
        "image/png",
      ),
    );
    return { blob, scale: canvas.width / base.width, release };
  } catch (e) {
    release();
    throw e;
  }
}
