/**
 * 瀏覽器端 Tesseract.js（v7）OCR 引擎。
 * - worker 與 WASM 核心由 public/tesseract 同源提供（版本與安裝的 tesseract.js 一致）。
 * - 語言模型：若 public/tessdata 有本機檔案則使用；否則由 Tesseract.js 預設來源（jsDelivr 上的 @tesseract.js-data）下載，
 *   下載後由 Tesseract.js 快取於 IndexedDB（僅快取模型，不快取文件內容）。
 * - 只重用單一 worker，逐頁辨識；取消時 terminate，之後可重新 init。
 * - Tesseract.js 7 預設只輸出 text，必須明確要求 blocks／tsv 才有座標。
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { OCR_LANGUAGES, TESSDATA_LOCAL_BASE, TESSERACT_ASSET_BASE, type OcrLanguageKey } from "../config";
import { AbortError, raceAbort, type OcrRecognition, type OcrRunner } from "../pipeline/controller";
import type { OcrQuality } from "../types";
import type { OcrPageData } from "./normalize";
import { renderPageForOcr } from "./render";

interface TesseractWorker {
  recognize(
    image: Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: OcrPageData }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(
    langs: string[],
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

async function loadTesseract(): Promise<TesseractModule> {
  const mod = (await import("tesseract.js")) as unknown as TesseractModule & { default?: TesseractModule };
  const api = typeof mod.createWorker === "function" ? mod : mod.default;
  if (!api || typeof api.createWorker !== "function") throw new Error("無法載入 Tesseract.js（createWorker 不存在）");
  return api;
}

/** 檢查本機是否已放置語言模型（scripts/download-tessdata.mjs）；不存在時回傳 false。 */
async function hasLocalModels(langs: readonly string[]): Promise<boolean> {
  try {
    const responses = await Promise.all(
      langs.map((l) => fetch(`${TESSDATA_LOCAL_BASE}/${l}.traineddata.gz`, { method: "HEAD" })),
    );
    return responses.every((r) => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html"));
  } catch {
    return false;
  }
}

const OEM_LSTM_ONLY = 1;

export class OcrEngine {
  private worker: TesseractWorker | null = null;
  private readonly langs: readonly string[];

  constructor(languageKey: OcrLanguageKey) {
    this.langs = OCR_LANGUAGES[languageKey].langs;
  }

  async init(onStatus: (e: { status: string; progress: number }) => void, signal?: AbortSignal): Promise<void> {
    if (this.worker) return;
    const tesseract = await raceAbort(loadTesseract(), signal);
    const useLocal = await raceAbort(hasLocalModels(this.langs), signal);
    const options: Record<string, unknown> = {
      workerPath: `${TESSERACT_ASSET_BASE}/worker.min.js`,
      corePath: `${TESSERACT_ASSET_BASE}/core`,
      logger: (m: { status?: string; progress?: number }) =>
        onStatus({ status: m.status ?? "", progress: typeof m.progress === "number" ? m.progress : 0 }),
      errorHandler: () => undefined,
    };
    if (useLocal) options.langPath = TESSDATA_LOCAL_BASE;
    const creation = tesseract.createWorker([...this.langs], OEM_LSTM_ONLY, options);
    try {
      this.worker = await raceAbort(creation, signal);
    } catch (e) {
      // 取消或失敗時，若 worker 之後才建立完成，也要確保被終止
      creation.then((w) => w.terminate()).catch(() => undefined);
      throw e;
    }
  }

  async recognize(blob: Blob, signal?: AbortSignal): Promise<OcrPageData> {
    if (!this.worker) throw new Error("OCR 引擎尚未初始化");
    const res = await raceAbort(
      this.worker.recognize(blob, {}, { text: true, blocks: true, tsv: true }),
      signal,
    );
    return res.data;
  }

  async terminate(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate().catch(() => undefined);
  }
}

/** 建立與 PDF 文件綁定的 OCR runner。 */
export function createBrowserOcrRunner(
  doc: PDFDocumentProxy,
  languageKey: OcrLanguageKey,
  quality: OcrQuality,
): OcrRunner {
  const engine = new OcrEngine(languageKey);
  return {
    init: (onStatus, signal) => engine.init(onStatus, signal),
    async recognizePage(pageNumber, signal): Promise<OcrRecognition> {
      if (signal?.aborted) throw new AbortError();
      const page = await doc.getPage(pageNumber);
      const rendered = await renderPageForOcr(page, quality);
      try {
        const data = await engine.recognize(rendered.blob, signal);
        return { data, scale: rendered.scale };
      } finally {
        rendered.release();
      }
    },
    dispose: () => engine.terminate(),
  };
}
