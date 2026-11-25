"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { collectWarnings } from "@/lib/pipeline/controller";
import type { ConversionResult } from "@/lib/types";
import GridPreview from "./GridPreview";
import ReportPanel from "./ReportPanel";
import TablePreview from "./TablePreview";
import TextPreview from "./TextPreview";

interface Props {
  result: ConversionResult;
  exporting: boolean;
  exportError: string | null;
  onDownloadExcel: () => void;
  onDownloadJson: () => void;
  onChooseAnother: () => void;
  onClear: () => void;
}

const TABS = [
  { id: "text", label: "全文預覽" },
  { id: "grid", label: "頁面格線" },
  { id: "tables", label: "表格候選" },
  { id: "report", label: "處理報告" },
] as const;

export default function ResultsPanel({ result, exporting, exportError, onDownloadExcel, onDownloadJson, onChooseAnother, onClear }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("text");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const stats = useMemo(() => {
    const p = result.pages;
    return {
      total: result.totalPages,
      success: p.filter((x) => x.status === "ok" || x.status === "empty").length,
      failed: p.filter((x) => x.status === "failed").length,
      skipped: p.filter((x) => x.status === "skipped").length,
      scanned: p.filter((x) => x.suspectedScanned).length,
      ocr: p.filter((x) => x.ocrStatus === "done").length,
      tables: p.reduce((n, x) => n + x.tableCount, 0),
      unassigned: p.reduce((n, x) => n + x.unassignedCount, 0),
      warnings: collectWarnings(result).length,
    };
  }, [result]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const cards: [string, string | number][] = [
    ["文件總頁數", stats.total],
    ["成功頁數", stats.success],
    ["失敗頁數", stats.failed],
    ["略過頁數", stats.skipped],
    ["疑似掃描頁數", stats.scanned],
    ["OCR 頁數", stats.ocr],
    ["表格候選數", stats.tables],
    ["未分類片段數（未進入表格）", stats.unassigned],
    ["處理耗時", `${(result.durationMs / 1000).toFixed(1)} 秒`],
    ["警告數", stats.warnings],
  ];
  const banner =
    result.status === "complete"
      ? { text: "完成", cls: "bg-emerald-50 text-emerald-900 border-emerald-200" }
      : { text: "部分完成：部分頁面失敗、略過或可能缺少文字，請查看警告與處理報告。", cls: "bg-amber-50 text-amber-900 border-amber-200" };

  return (
    <section aria-labelledby="result-title" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="results">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="result-title" className="text-xl font-semibold">
          轉換結果
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onDownloadExcel}
            disabled={exporting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {exporting ? "建立 Excel…" : "下載 Excel"}
          </button>
          <button onClick={onDownloadJson} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            下載原始結果 JSON
          </button>
          <button onClick={onChooseAnother} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            重新選擇文件
          </button>
          <button onClick={onClear} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            清除所有結果
          </button>
        </div>
      </div>
      {exportError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          建立 Excel 失敗：{exportError}
        </p>
      )}
      <p role="status" className={`rounded-lg border px-4 py-2 text-sm font-medium ${banner.cls}`} data-testid="result-status">
        {banner.text}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-600">{k}</dt>
            <dd className="mt-1 text-lg font-semibold" data-testid={`stat-${k}`}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <div role="tablist" aria-label="結果預覽" className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                tab === t.id ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-4">
          {tab === "text" && <TextPreview result={result} />}
          {tab === "grid" && <GridPreview result={result} />}
          {tab === "tables" && <TablePreview result={result} />}
          {tab === "report" && <ReportPanel result={result} />}
        </div>
      </div>
    </section>
  );
}
