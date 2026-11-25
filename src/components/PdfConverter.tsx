"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HARD_MAX_FILE_BYTES, HARD_MAX_PAGES, SOFT_MAX_FILE_BYTES, SOFT_MAX_PAGES } from "@/lib/config";
import { PdfPasswordError, openPdf, type OpenedPdf } from "@/lib/pdf/loader";
import { isAbortError, runPipeline } from "@/lib/pipeline/controller";
import { DEFAULT_OPTIONS, type ConversionOptions as Options, type ConversionResult, type ProgressEvent } from "@/lib/types";
import { downloadBlob, outputFileName } from "@/lib/utils/download";
import { parsePageRanges } from "@/lib/utils/page-ranges";
import ConversionOptions from "./ConversionOptions";
import FileDropzone from "./FileDropzone";
import PasswordDialog from "./PasswordDialog";
import ProgressPanel from "./ProgressPanel";
import ResultsPanel from "./ResultsPanel";

type Phase = "idle" | "opening" | "password" | "ready" | "converting" | "done" | "cancelled";

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function PdfConverter() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ incorrect: boolean } | null>(null);
  const [ocrPrompt, setOcrPrompt] = useState<{ message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const openedRef = useRef<OpenedPdf | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const ocrResolveRef = useRef<((d: "retry" | "skip") => void) | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const runIdRef = useRef(0);

  /** 清理所有 worker、PDF document 與進行中的運算 */
  const cleanup = useCallback(async () => {
    runIdRef.current++;
    abortRef.current?.abort();
    exportAbortRef.current?.abort();
    ocrResolveRef.current?.("skip");
    ocrResolveRef.current = null;
    disposeRef.current?.();
    disposeRef.current = null;
    const opened = openedRef.current;
    openedRef.current = null;
    if (opened) await opened.destroy();
  }, []);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const resetAll = useCallback(async () => {
    await cleanup();
    pendingFileRef.current = null;
    setPhase("idle");
    setFile(null);
    setPages(0);
    setError(null);
    setResult(null);
    setProgress(null);
    setPasswordPrompt(null);
    setOcrPrompt(null);
    setConfirmLarge(false);
    setExportError(null);
  }, [cleanup]);

  const openFile = useCallback(
    async (f: File, password?: string) => {
      setError(null);
      setPhase("opening");
      try {
        const opened = await openPdf(f, password);
        openedRef.current = opened;
        setFile(f);
        setPages(opened.numPages);
        setPasswordPrompt(null);
        setConfirmLarge(false);
        setPhase("ready");
      } catch (e) {
        if (e instanceof PdfPasswordError) {
          pendingFileRef.current = f;
          setFile(f);
          setPasswordPrompt({ incorrect: e.incorrect });
          setPhase("password");
          return;
        }
        pendingFileRef.current = null;
        setFile(null);
        setPhase("idle");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const onFile = useCallback(
    async (f: File) => {
      await cleanup();
      setResult(null);
      setProgress(null);
      setExportError(null);
      await openFile(f);
    },
    [cleanup, openFile],
  );

  const startConversion = async () => {
    const opened = openedRef.current;
    if (!file || !opened) return;
    if (options.ocrMode === "pages") {
      const check = parsePageRanges(options.ocrPages, opened.numPages);
      if (check.errors.length) {
        setError(`OCR 頁碼格式錯誤：${check.errors.join("；")}`);
        return;
      }
    }
    setError(null);
    setResult(null);
    setExportError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const myRun = ++runIdRef.current;
    setPhase("converting");
    setProgress({ phase: "reading", message: "正在讀取 PDF…", current: 0, total: opened.numPages });
    try {
      const { createBrowserPipeline } = await import("@/lib/pipeline/browser");
      const pipeline = await createBrowserPipeline(opened, options);
      disposeRef.current = pipeline.dispose;
      const res = await runPipeline({
        deps: pipeline.deps,
        options,
        fileName: file.name,
        fileSize: file.size,
        signal: controller.signal,
        onProgress: (p) => {
          if (runIdRef.current === myRun) setProgress(p);
        },
        onOcrInitError: (message) =>
          new Promise((resolve) => {
            ocrResolveRef.current = (d) => {
              setOcrPrompt(null);
              resolve(d);
            };
            setOcrPrompt({ message });
          }),
      });
      pipeline.dispose();
      disposeRef.current = null;
      if (runIdRef.current !== myRun) return;
      setResult(res);
      setProgress({ phase: "done", message: res.status === "complete" ? "完成" : "部分完成", current: res.totalPages, total: res.totalPages });
      setPhase("done");
    } catch (e) {
      disposeRef.current?.();
      disposeRef.current = null;
      if (runIdRef.current !== myRun) return;
      if (isAbortError(e) || controller.signal.aborted) {
        setProgress({ phase: "cancelled", message: "已取消", current: 0, total: opened.numPages });
        setPhase("cancelled");
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("ready");
      }
    } finally {
      setOcrPrompt(null);
      ocrResolveRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    ocrResolveRef.current?.("skip");
    disposeRef.current?.();
    disposeRef.current = null;
  };

  const downloadExcel = async () => {
    if (!result) return;
    setExporting(true);
    setExportError(null);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const { buildWorkbookOffThread } = await import("@/lib/pipeline/workers");
      const buffer = await buildWorkbookOffThread(result, controller.signal);
      downloadBlob(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        outputFileName(result.fileName, "xlsx"),
      );
    } catch (e) {
      if (!isAbortError(e)) setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
    }
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    downloadBlob(blob, outputFileName(result.fileName, "json").replace(/\.json$/, ".raw.json"));
  };

  const large = !!file && (file.size > SOFT_MAX_FILE_BYTES || pages > SOFT_MAX_PAGES);
  const canStart = phase === "ready" && (!large || confirmLarge);
  const busy = phase === "opening" || phase === "converting";

  return (
    <div className="space-y-6">
      <section aria-labelledby="file-title" className="space-y-4">
        <h2 id="file-title" className="text-xl font-semibold">
          1. 選擇 PDF
        </h2>
        <FileDropzone disabled={busy} onFile={onFile} />
        <p className="text-sm text-slate-600">
          建議 {mb(SOFT_MAX_FILE_BYTES)}／{SOFT_MAX_PAGES} 頁以內；安全上限 {mb(HARD_MAX_FILE_BYTES)}／{HARD_MAX_PAGES} 頁。檔案以檔頭與解析結果驗證，不只看副檔名。
        </p>
        {phase === "opening" && (
          <p role="status" className="text-sm text-slate-700">
            讀取文件中…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="error-message">
            {error}
          </p>
        )}
        {file && phase !== "idle" && phase !== "password" && (
          <dl className="grid grid-cols-1 gap-2 rounded-lg bg-white p-4 text-sm shadow-sm sm:grid-cols-3" data-testid="file-info">
            <div>
              <dt className="text-slate-500">檔名</dt>
              <dd className="break-all font-medium">{file.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">大小</dt>
              <dd className="font-medium">{mb(file.size)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">頁數</dt>
              <dd className="font-medium">{pages} 頁</dd>
            </div>
          </dl>
        )}
        {large && phase === "ready" && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">效能警告</p>
            <p className="mt-1">
              此文件超過建議大小或頁數。所有處理都在你的瀏覽器內進行，可能耗用大量記憶體與時間，手機尤其容易失敗；轉換結果也會保存在記憶體中。
            </p>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
              我了解風險，仍要繼續
            </label>
          </div>
        )}
      </section>

      {(phase === "ready" || phase === "cancelled" || phase === "done") && file && (
        <section aria-labelledby="opt-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="opt-title" className="text-xl font-semibold">
            2. 轉換設定
          </h2>
          <ConversionOptions options={options} totalPages={pages} onChange={setOptions} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={startConversion}
              disabled={!canStart && phase === "ready"}
              className="rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "ready" ? "開始轉換" : "重新轉換"}
            </button>
            {phase === "cancelled" && <span role="status" className="text-sm font-medium text-slate-700">已取消，未保留部分結果。</span>}
          </div>
        </section>
      )}

      {phase === "converting" && <ProgressPanel progress={progress} onCancel={cancel} ocrPrompt={ocrPrompt} onOcrDecision={(d) => ocrResolveRef.current?.(d)} />}

      {phase === "done" && result && (
        <ResultsPanel
          result={result}
          exporting={exporting}
          exportError={exportError}
          onDownloadExcel={downloadExcel}
          onDownloadJson={downloadJson}
          onChooseAnother={() => {
            void resetAll();
          }}
          onClear={() => {
            void resetAll();
          }}
        />
      )}

      {phase === "password" && file && passwordPrompt && (
        <PasswordDialog
          fileName={file.name}
          incorrect={passwordPrompt.incorrect}
          onSubmit={(pw) => {
            const f = pendingFileRef.current;
            if (f) void openFile(f, pw);
          }}
          onCancel={() => {
            void resetAll();
          }}
        />
      )}
    </div>
  );
}
