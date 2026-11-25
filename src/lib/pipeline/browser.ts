/** 將瀏覽器端的 PDF.js 文件與 OCR 組裝成 pipeline 依賴。僅限瀏覽器。 */
import { createBrowserOcrRunner } from "../ocr/engine";
import { extractNativePage } from "../pdf/extract";
import { loadPdfjs, type OpenedPdf } from "../pdf/loader";
import type { ConversionOptions } from "../types";
import type { PipelineDeps } from "./controller";
import { AnalysisClient } from "./workers";

export interface BrowserPipeline {
  deps: PipelineDeps;
  /** 取消或完成後呼叫，釋放 worker */
  dispose: () => void;
}

export async function createBrowserPipeline(opened: OpenedPdf, options: ConversionOptions): Promise<BrowserPipeline> {
  const pdfjs = await loadPdfjs();
  const analysis = new AnalysisClient();
  const ops = pdfjs.OPS as unknown as Record<string, number>;
  const deps: PipelineDeps = {
    source: {
      numPages: opened.numPages,
      async extractNative(pageNumber) {
        const page = await opened.doc.getPage(pageNumber);
        try {
          return await extractNativePage(page, pageNumber, ops);
        } finally {
          page.cleanup();
        }
      },
    },
    analyze: (input) => analysis.analyze(input),
    createOcr:
      options.ocrMode === "off"
        ? undefined
        : () => createBrowserOcrRunner(opened.doc, options.ocrLanguage, options.ocrQuality),
  };
  return { deps, dispose: () => analysis.terminate() };
}
