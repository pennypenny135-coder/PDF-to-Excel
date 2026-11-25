/**
 * OCR 煙霧測試（Node 版 Tesseract.js + 真實 PDF 渲染）。
 * 需要網路下載英文語言模型（首次），之後快取在 .ocr-cache。以 `npm run test:ocr` 執行。
 * 驗證：Tesseract.js 7 需明確要求 blocks 才有座標；字詞 bbox 映射回頁面座標；信心值存在。
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createWorker } from "tesseract.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeOcrPage, type OcrPageData } from "../../src/lib/ocr/normalize";
import { computeOcrScale } from "../../src/lib/ocr/render";
import { openFixture } from "../helpers/pdf";

const cachePath = resolve(__dirname, "..", "..", ".ocr-cache");
let worker: Awaited<ReturnType<typeof createWorker>>;

beforeAll(async () => {
  mkdirSync(cachePath, { recursive: true });
  worker = await createWorker(["eng"], 1, { cachePath });
}, 240_000);

afterAll(async () => {
  await worker?.terminate();
});

describe("Tesseract.js OCR（真實辨識）", () => {
  it("掃描頁：辨識文字，輸出字詞座標（頁面座標系）與信心", async () => {
    const { doc, destroy } = await openFixture("scanned.pdf");
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = computeOcrScale(base.width, base.height, "standard");
      const viewport = page.getViewport({ scale });
      const { canvas, context } = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer }; context: unknown } } }).canvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({ canvasContext: context as never, canvas: canvas as never, viewport }).promise;
      const png = canvas.toBuffer("image/png");

      // 沒要求 blocks 時沒有座標資料（Tesseract.js 7 預設只輸出 text）
      const plain = await worker.recognize(png);
      expect(plain.data.blocks == null).toBe(true);
      expect(plain.data.text).toMatch(/INVOICE/i);

      const res = await worker.recognize(png, {}, { text: true, blocks: true, tsv: true });
      const data = res.data as unknown as OcrPageData;
      expect(Array.isArray(data.blocks)).toBe(true);
      const norm = normalizeOcrPage(data, {
        pageNumber: 1,
        renderScale: scale,
        pageWidth: base.width,
        pageHeight: base.height,
      });
      expect(norm.granularity).toBe("word");
      const words = norm.fragments;
      const invoice = words.find((w) => /INVOICE/i.test(w.text));
      const hello = words.find((w) => /HELLO/i.test(w.text));
      expect(invoice).toBeDefined();
      expect(hello).toBeDefined();
      // 圖片放置於 PDF 座標 x 72–522、y 500–680 → 左上角原點 y 162–342
      expect(invoice!.bbox.x).toBeGreaterThan(70);
      expect(invoice!.bbox.x + invoice!.bbox.width).toBeLessThan(525);
      expect(invoice!.bbox.y).toBeGreaterThan(160);
      expect(hello!.bbox.y).toBeGreaterThan(invoice!.bbox.y);
      expect(hello!.bbox.y + hello!.bbox.height).toBeLessThan(345);
      expect(typeof invoice!.confidence).toBe("number");
      expect(invoice!.source).toBe("ocr");
      page.cleanup();
    } finally {
      await destroy();
    }
  }, 120_000);
});
