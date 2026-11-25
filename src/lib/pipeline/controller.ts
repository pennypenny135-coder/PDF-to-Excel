/**
 * 轉換流程控制：逐頁抽取 → 版面分析 → 可選 OCR → 選定主要來源。
 * 此模組不直接依賴 PDF.js／Tesseract／Worker，全部透過 deps 注入，
 * 因此可用真實 PDF 在 Node 測試，也可用注入的失敗／取消情境測試容錯。
 */
import { SCAN_TEXT_CHAR_THRESHOLD } from "../config";
import { splitSupplement, type AnalyzeInput, type AnalyzeOutput } from "../pdf/analyze";
import type { NativeExtraction } from "../pdf/extract";
import { normalizeOcrPage, type OcrPageData } from "../ocr/normalize";
import type {
  ConversionOptions,
  ConversionResult,
  OcrStatus,
  PageResult,
  PageStatus,
  PrimarySource,
  ProgressEvent,
  TextFragment,
} from "../types";
import { parsePageRanges } from "../utils/page-ranges";

export class AbortError extends Error {
  constructor(message = "已取消") {
    super(message);
    this.name = "AbortError";
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

/** 讓 promise 在 signal 中止時立即 reject（底層運算由呼叫端負責 terminate）。 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new AbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export interface NativeSource {
  numPages: number;
  extractNative(pageNumber: number): Promise<NativeExtraction>;
}

export interface OcrRecognition {
  data: OcrPageData;
  /** canvas 像素 / 頁面座標 */
  scale: number;
}

export interface OcrRunner {
  init(onStatus: (e: { status: string; progress: number }) => void, signal?: AbortSignal): Promise<void>;
  recognizePage(pageNumber: number, signal?: AbortSignal): Promise<OcrRecognition>;
  dispose(): Promise<void>;
}

export interface PipelineDeps {
  source: NativeSource;
  analyze: (input: AnalyzeInput) => Promise<AnalyzeOutput>;
  createOcr?: () => OcrRunner;
}

export interface PipelineParams {
  deps: PipelineDeps;
  options: ConversionOptions;
  fileName: string;
  fileSize: number;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
  /** OCR 模型載入失敗時詢問使用者：重試或略過 OCR；預設略過 */
  onOcrInitError?: (message: string) => Promise<"retry" | "skip">;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyAnalysis(): AnalyzeOutput {
  return { fragments: [], lines: [], tables: [], grid: null, warnings: [] };
}

export async function runPipeline(params: PipelineParams): Promise<ConversionResult> {
  const { deps, options, signal, onProgress } = params;
  const total = deps.source.numPages;
  const startedAt = new Date();
  const t0 = performance.now();
  const warnings: string[] = [];
  const emit = (e: ProgressEvent) => onProgress?.(e);

  let ocrTargets: Set<number> | null = null;
  if (options.ocrMode === "pages") {
    const r = parsePageRanges(options.ocrPages, total);
    if (r.errors.length) throw new Error(`OCR 頁碼格式錯誤：${r.errors.join("；")}`);
    ocrTargets = new Set(r.pages);
    if (r.outOfRange.length) {
      warnings.push(`OCR 指定的頁碼超出文件頁數（共 ${total} 頁），已忽略：${r.outOfRange.slice(0, 20).join(", ")}`);
    }
    if (r.pages.length === 0) warnings.push("OCR 指定頁面中沒有任何有效頁碼，不會執行 OCR。");
  }

  let ocr = null as OcrRunner | null;
  let ocrState: "idle" | "ready" | "failed" = "idle";
  let ocrInitFailed = false;

  const ensureOcr = async (pageNumber: number): Promise<boolean> => {
    if (ocrState === "ready") return true;
    if (ocrState === "failed") return false;
    if (!deps.createOcr) {
      ocrState = "failed";
      ocrInitFailed = true;
      warnings.push("此環境不支援 OCR，已略過。");
      return false;
    }
    for (;;) {
      try {
        ocr ??= deps.createOcr();
        emit({ phase: "ocr-model", message: "準備 OCR（首次使用需下載辨識模型）…", current: pageNumber, total });
        await ocr.init((s) => {
          emit({
            phase: "ocr-model",
            message: `OCR 模型：${s.status}`,
            current: pageNumber,
            total,
            fraction: Number.isFinite(s.progress) ? s.progress : undefined,
          });
        }, signal);
        ocrState = "ready";
        return true;
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) throw new AbortError();
        const msg = errMessage(e);
        await ocr?.dispose().catch(() => undefined);
        ocr = null;
        const decision = params.onOcrInitError ? await params.onOcrInitError(msg) : "skip";
        throwIfAborted(signal);
        if (decision === "retry") continue;
        ocrState = "failed";
        ocrInitFailed = true;
        warnings.push(`OCR 模型載入失敗（${msg}），已略過 OCR；掃描頁可能缺少文字。`);
        return false;
      }
    }
  };

  const pages: PageResult[] = [];

  const processPage = async (n: number): Promise<PageResult> => {
    const pt0 = performance.now();
    const pageWarnings: string[] = [];
    const base: PageResult = {
      pageNumber: n,
      width: 0,
      height: 0,
      pageRotation: 0,
      status: "ok",
      nativeFragmentCount: 0,
      ocrFragmentCount: 0,
      nativeCharCount: 0,
      suspectedScanned: false,
      suspectedBlank: false,
      ocrStatus: "not-run",
      primarySource: "none",
      primaryReason: "",
      tableCount: 0,
      unassignedCount: 0,
      durationMs: 0,
      warnings: pageWarnings,
      error: null,
      lines: [],
      tables: [],
      grid: null,
      fragments: [],
    };
    let native: NativeExtraction | null = null;
    try {
      emit({ phase: "extracting", message: `第 ${n} / ${total} 頁：抽取文字`, current: n, total });
      native = await raceAbort(deps.source.extractNative(n), signal);
      base.width = native.width;
      base.height = native.height;
      base.pageRotation = native.pageRotation;
      base.nativeFragmentCount = native.fragments.length;
      base.nativeCharCount = native.charCount;
      base.suspectedScanned = native.suspectedScanned;
      base.suspectedBlank = native.suspectedBlank;
      pageWarnings.push(...native.warnings);
      base.fragments = native.fragments;

      emit({ phase: "layout", message: `第 ${n} / ${total} 頁：重建版面`, current: n, total });
      let nativeOut: AnalyzeOutput = emptyAnalysis();
      if (native.fragments.length > 0) {
        if (options.detectTables) {
          emit({ phase: "tables", message: `第 ${n} / ${total} 頁：識別表格`, current: n, total });
        }
        nativeOut = await raceAbort(
          deps.analyze({
            pageNumber: n,
            source: "native",
            width: native.width,
            height: native.height,
            fragments: native.fragments,
            detectTables: options.detectTables,
            buildGrid: options.buildPageGrid,
          }),
          signal,
        );
        pageWarnings.push(...nativeOut.warnings);
      }
      base.fragments = nativeOut.fragments.length ? nativeOut.fragments : native.fragments;

      // ---- OCR ----
      const wantOcr =
        options.ocrMode === "auto" ? native.suspectedScanned : options.ocrMode === "pages" ? !!ocrTargets?.has(n) : false;
      let ocrFrags: TextFragment[] = [];
      let ocrStatus: OcrStatus = "not-run";
      if (wantOcr) {
        const ready = await ensureOcr(n);
        if (!ready) {
          ocrStatus = "skipped";
          pageWarnings.push("OCR 不可用，已略過此頁 OCR。");
        } else {
          try {
            emit({ phase: "ocr", message: `OCR 第 ${n} 頁（共 ${total} 頁）`, current: n, total });
            const rec = await raceAbort(ocr!.recognizePage(n, signal), signal);
            const norm = normalizeOcrPage(rec.data, {
              pageNumber: n,
              renderScale: rec.scale,
              pageWidth: native.width,
              pageHeight: native.height,
            });
            ocrFrags = norm.fragments;
            pageWarnings.push(...norm.warnings);
            ocrStatus = "done";
          } catch (e) {
            if (isAbortError(e) || signal?.aborted) throw new AbortError();
            ocrStatus = "failed";
            pageWarnings.push(`OCR 失敗：${errMessage(e)}`);
          }
        }
      }
      base.ocrStatus = ocrStatus;
      base.ocrFragmentCount = ocrFrags.length;

      // ---- 選定主要來源（原生與 OCR 不盲目合併）----
      const nativeInsufficient = native.charCount < SCAN_TEXT_CHAR_THRESHOLD;
      const hasNative = native.fragments.length > 0;
      const useOcr = ocrStatus === "done" && ocrFrags.length > 0 && (!hasNative || nativeInsufficient);
      let primary: PrimarySource = "none";
      let reason = "";
      let finalNative = base.fragments;
      let finalOcr = ocrFrags;

      if (useOcr) {
        primary = "ocr";
        reason = hasNative
          ? `原生文字極少（${native.charCount} 字），採用 OCR 結果為主；原生文字中與 OCR 不重疊的部分另行補充。`
          : "此頁沒有原生文字層，採用 OCR 結果。";
        const ocrOut = await raceAbort(
          deps.analyze({
            pageNumber: n,
            source: "ocr",
            width: native.width,
            height: native.height,
            fragments: ocrFrags,
            detectTables: options.detectTables,
            buildGrid: options.buildPageGrid,
          }),
          signal,
        );
        pageWarnings.push(...ocrOut.warnings);
        finalOcr = ocrOut.fragments;
        base.lines = ocrOut.lines;
        base.tables = ocrOut.tables;
        base.grid = ocrOut.grid;
        if (hasNative) {
          const { keep, overlapped } = splitSupplement(finalOcr, finalNative);
          const mark = new Set(overlapped.map((f) => f.id));
          finalNative = finalNative.map((f) =>
            mark.has(f.id) ? { ...f, warnings: [...f.warnings, "與 OCR 主要來源重疊，未重複輸出到全文（原始片段保留）。"] } : f,
          );
          if (keep.length) {
            const supp = await raceAbort(
              deps.analyze({
                pageNumber: n,
                source: "native",
                width: native.width,
                height: native.height,
                fragments: keep,
                detectTables: false,
                buildGrid: false,
                firstLineNumber: base.lines.length + 1,
                supplemental: true,
              }),
              signal,
            );
            base.lines = [...base.lines, ...supp.lines];
            const byId = new Map(supp.fragments.map((f) => [f.id, f]));
            finalNative = finalNative.map((f) => byId.get(f.id) ?? f);
          }
        }
      } else if (hasNative) {
        primary = "native";
        base.lines = nativeOut.lines;
        base.tables = nativeOut.tables;
        base.grid = nativeOut.grid;
        if (options.ocrMode === "off") reason = "OCR 已關閉；使用 PDF 原生文字層。";
        else if (!wantOcr) {
          reason =
            options.ocrMode === "auto"
              ? "自動 OCR：此頁有原生文字層，未執行 OCR（文字頁中的圖片文字不會自動辨識，可改用「指定頁面」OCR）。"
              : "此頁不在 OCR 指定頁面內；使用 PDF 原生文字層。";
        } else if (ocrStatus === "done") {
          reason = "此頁有原生文字層，以原生文字為主要來源；OCR 結果另行保存，只補充與原生文字不重疊的內容（例如圖片中的文字）。";
        } else {
          reason = "OCR 未成功；使用 PDF 原生文字層。";
        }
        if (ocrStatus === "done" && ocrFrags.length > 0) {
          const { keep, overlapped } = splitSupplement(finalNative, ocrFrags);
          const mark = new Set(overlapped.map((f) => f.id));
          finalOcr = ocrFrags.map((f) =>
            mark.has(f.id) ? { ...f, warnings: [...f.warnings, "與原生文字重疊，未重複輸出到全文（原始片段保留）。"] } : f,
          );
          if (keep.length) {
            const supp = await raceAbort(
              deps.analyze({
                pageNumber: n,
                source: "ocr",
                width: native.width,
                height: native.height,
                fragments: keep,
                detectTables: false,
                buildGrid: false,
                firstLineNumber: base.lines.length + 1,
                supplemental: true,
              }),
              signal,
            );
            base.lines = [...base.lines, ...supp.lines];
            const byId = new Map(supp.fragments.map((f) => [f.id, f]));
            finalOcr = finalOcr.map((f) => byId.get(f.id) ?? f);
            pageWarnings.push(`已補充 ${supp.lines.length} 行與原生文字不重疊的 OCR 內容（可能有誤）。`);
          }
        }
      } else {
        reason = "此頁沒有可用文字。";
      }

      // 未被選為主要來源的片段仍保留，並註明原因
      if (primary === "native") {
        finalOcr = finalOcr.map((f) =>
          f.assignedLineId || f.warnings.some((w) => w.includes("未重複輸出")) ? f : { ...f, warnings: [...f.warnings, "非主要來源，未輸出到全文。"] },
        );
      }

      base.primarySource = primary;
      base.primaryReason = reason;
      base.fragments = [...finalNative, ...finalOcr];
      base.tableCount = base.tables.length;
      const primaryFrags = primary === "ocr" ? finalOcr : primary === "native" ? finalNative : [];
      base.unassignedCount = primaryFrags.filter((f) => !f.assignedTableId).length;

      // ---- 狀態 ----
      let status: PageStatus = "ok";
      if (primary === "none") {
        if (ocrStatus === "done") {
          status = "empty";
          pageWarnings.push("OCR 沒有辨識出文字；此頁可能沒有文字內容。");
        } else if (native.suspectedScanned) {
          status = "skipped";
          if (ocrStatus === "failed") pageWarnings.push("OCR 失敗，此頁可能缺少文字。");
          else if (ocrStatus === "skipped") pageWarnings.push("OCR 已略過，此頁可能缺少文字。");
          else pageWarnings.push("未 OCR，可能缺少文字。");
        } else {
          status = "empty";
          pageWarnings.push("此頁沒有可抽取的文字，疑似空白頁（啟發式判斷，不能確定）。");
        }
      } else if (native.suspectedScanned && ocrStatus !== "done" && primary === "native") {
        // 幾乎沒有文字，且 OCR 未成功
        status = "skipped";
        pageWarnings.push("此頁原生文字極少，疑似掃描頁；未 OCR，可能缺少文字。");
      }
      base.status = status;
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw new AbortError();
      base.status = "failed";
      base.error = errMessage(e);
      pageWarnings.push(`此頁處理失敗：${errMessage(e)}`);
    }
    base.durationMs = Math.round(performance.now() - pt0);
    return base;
  };

  try {
    for (let n = 1; n <= total; n++) {
      throwIfAborted(signal);
      pages.push(await processPage(n));
      await yieldToUi();
    }
  } finally {
    if (ocr) await ocr.dispose().catch(() => undefined);
  }
  throwIfAborted(signal);

  const failed = pages.filter((p) => p.status === "failed").length;
  const skipped = pages.filter((p) => p.status === "skipped").length;
  const unOcrScanned = pages.filter((p) => p.suspectedScanned && p.ocrStatus !== "done").length;
  if (unOcrScanned > 0) {
    warnings.push(`${unOcrScanned} 頁疑似掃描頁但未成功 OCR，可能缺少文字。`);
  }
  return {
    fileName: params.fileName,
    fileSize: params.fileSize,
    totalPages: total,
    options,
    status: failed > 0 || skipped > 0 || ocrInitFailed ? "partial" : "complete",
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now() - t0),
    pages,
    warnings,
  };
}

export interface CollectedWarning {
  page: number | null;
  message: string;
}

export function collectWarnings(result: ConversionResult): CollectedWarning[] {
  const list: CollectedWarning[] = result.warnings.map((message) => ({ page: null, message }));
  for (const p of result.pages) {
    for (const message of p.warnings) list.push({ page: p.pageNumber, message });
    for (const t of p.tables) for (const message of t.warnings) list.push({ page: p.pageNumber, message: `${t.id}：${message}` });
    if (p.grid) for (const message of p.grid.warnings) list.push({ page: p.pageNumber, message: `頁面格線：${message}` });
  }
  return list;
}
