"use client";

import type { ProgressEvent } from "@/lib/types";

interface Props {
  progress: ProgressEvent | null;
  onCancel: () => void;
  ocrPrompt: { message: string } | null;
  onOcrDecision: (d: "retry" | "skip") => void;
}

const PHASE_LABEL: Record<string, string> = {
  reading: "讀取文件",
  extracting: "抽取文字",
  layout: "重建版面",
  tables: "識別表格",
  "ocr-model": "下載 OCR 模型",
  ocr: "OCR",
  excel: "建立 Excel",
  done: "完成",
  cancelled: "已取消",
};

export default function ProgressPanel({ progress, onCancel, ocrPrompt, onOcrDecision }: Props) {
  const pct =
    progress && progress.phase === "ocr-model" && progress.fraction != null
      ? Math.round(progress.fraction * 100)
      : progress && progress.total > 0
        ? Math.round(((progress.current - 1) / progress.total) * 100)
        : 0;
  return (
    <section aria-labelledby="progress-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="progress-panel">
      <h2 id="progress-title" className="text-lg font-semibold">
        處理進度
      </h2>
      <p role="status" aria-live="polite" className="mt-2 text-slate-800" data-testid="progress-message">
        <span className="mr-2 rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
          {progress ? (PHASE_LABEL[progress.phase] ?? progress.phase) : "讀取文件"}
        </span>
        {progress?.message ?? "正在讀取 PDF…"}
      </p>
      <div
        className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="轉換進度"
      >
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {progress && progress.total > 0 ? `第 ${progress.current} / ${progress.total} 頁` : ""}
        　大型文件需要較長時間與較多記憶體，此處不提供剩餘時間預測。
      </p>
      {ocrPrompt && (
        <div role="alertdialog" aria-labelledby="ocr-fail-title" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p id="ocr-fail-title" className="font-semibold text-amber-900">
            OCR 模型載入失敗
          </p>
          <p className="mt-1 break-words text-sm text-amber-900">{ocrPrompt.message}</p>
          <p className="mt-1 text-sm text-amber-900">可檢查網路後重試，或略過 OCR 繼續處理（掃描頁可能缺少文字）。</p>
          <div className="mt-3 flex gap-3">
            <button onClick={() => onOcrDecision("retry")} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
              重試下載
            </button>
            <button onClick={() => onOcrDecision("skip")} className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-900">
              略過 OCR
            </button>
          </div>
        </div>
      )}
      <button
        onClick={onCancel}
        className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        取消
      </button>
    </section>
  );
}
