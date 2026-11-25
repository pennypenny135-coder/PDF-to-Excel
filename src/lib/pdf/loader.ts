/**
 * PDF.js 載入（僅限瀏覽器；請以動態 import 使用，避免 SSR）。
 * worker 與 CMap／標準字體／WASM 皆來自 public/pdfjs（由 scripts/copy-pdf-assets.mjs 從已安裝的 pdfjs-dist 複製），
 * 因此版本與主套件一致，且不依賴外部 CDN。
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { HARD_MAX_FILE_BYTES, HARD_MAX_PAGES, PDFJS_ASSET_BASE, PDF_HEADER_SCAN_BYTES } from "../config";

export class PdfPasswordError extends Error {
  readonly incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? "密碼不正確，請重新輸入。" : "此 PDF 受密碼保護，請輸入開啟密碼。");
    this.name = "PdfPasswordError";
    this.incorrect = incorrect;
  }
}

export class PdfFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfFormatError";
  }
}

/** 檢查檔頭 "%PDF-"（規格允許出現在前 1024 bytes 內）。 */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, PDF_HEADER_SCAN_BYTES) - 4;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

/** 檢查檔案大小與檔頭，不只看副檔名。 */
export async function validatePdfFile(file: Blob): Promise<void> {
  if (file.size === 0) throw new PdfFormatError("檔案是空的（0 bytes）。");
  if (file.size > HARD_MAX_FILE_BYTES) {
    throw new PdfFormatError(
      `檔案大小 ${(file.size / 1024 / 1024).toFixed(1)} MB，超過安全上限 ${HARD_MAX_FILE_BYTES / 1024 / 1024} MB。`,
    );
  }
  const head = new Uint8Array(await file.slice(0, PDF_HEADER_SCAN_BYTES).arrayBuffer());
  if (!hasPdfHeader(head)) {
    throw new PdfFormatError("這不是有效的 PDF 檔案（找不到 %PDF- 檔頭）。請確認檔案格式，而不只是副檔名。");
  }
}

export type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (typeof window === "undefined") throw new Error("PDF.js 只能在瀏覽器中載入。");
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}/pdf.worker.min.mjs`;
      return mod;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
  destroy: () => Promise<void>;
}

/** 開啟 PDF。密碼只在記憶體中傳給 PDF.js，不寫入 log。 */
export async function openPdf(file: Blob, password?: string): Promise<OpenedPdf> {
  await validatePdfFile(file);
  const pdfjs = await loadPdfjs();
  // 每次開啟都重新讀取 bytes：PDF.js 會 transfer 該 buffer，之後即 detached，不可重複使用
  const data = new Uint8Array(await file.arrayBuffer());
  const base = `${window.location.origin}${PDFJS_ASSET_BASE}`;
  const task = pdfjs.getDocument({
    data,
    password: password || undefined,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
    iccUrl: `${base}/iccs/`,
    enableXfa: false,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > HARD_MAX_PAGES) {
      await task.destroy();
      throw new PdfFormatError(`此 PDF 共 ${doc.numPages} 頁，超過安全上限 ${HARD_MAX_PAGES} 頁。`);
    }
    return {
      doc,
      numPages: doc.numPages,
      destroy: async () => {
        try {
          await task.destroy();
        } catch {
          /* 已釋放 */
        }
      },
    };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    throw mapPdfError(e);
  }
}

export function mapPdfError(e: unknown): Error {
  if (e instanceof PdfPasswordError || e instanceof PdfFormatError) return e;
  const err = e as { name?: string; code?: number; message?: string };
  switch (err?.name) {
    case "PasswordException":
      return new PdfPasswordError(err.code === 2);
    case "InvalidPDFException":
      return new PdfFormatError("PDF 檔案已損壞或結構無效，無法讀取。");
    case "MissingPDFException":
      return new PdfFormatError("找不到 PDF 內容。");
    case "UnexpectedResponseException":
      return new PdfFormatError("讀取 PDF 時發生非預期的回應。");
    default:
      return new Error(`讀取 PDF 失敗：${err?.message ?? String(e)}`);
  }
}
