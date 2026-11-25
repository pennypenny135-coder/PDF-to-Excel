"use client";

import { useMemo, useState } from "react";
import { PREVIEW_PAGE_SIZE } from "@/lib/config";
import type { ConversionResult } from "@/lib/types";
import Pager from "./Pager";

export default function TablePreview({ result }: { result: ConversionResult }) {
  const tables = useMemo(() => result.pages.flatMap((p) => p.tables), [result]);
  const [sel, setSel] = useState<string | null>(null);
  const [rowPage, setRowPage] = useState(0);

  if (!result.options.detectTables) return <p className="text-slate-600">本次轉換未啟用表格識別。</p>;
  if (tables.length === 0)
    return <p className="text-slate-600">沒有偵測到表格候選。全文與原始片段仍完整保留，可直接下載。</p>;

  const t = tables.find((x) => x.id === sel) ?? tables[0];
  const pageCount = Math.max(1, Math.ceil(t.rows.length / PREVIEW_PAGE_SIZE));
  const current = Math.min(rowPage, pageCount - 1);
  const slice = t.rows.slice(current * PREVIEW_PAGE_SIZE, (current + 1) * PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="table-select" className="text-sm font-medium">表格候選</label>
        <select
          id="table-select"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          value={t.id}
          onChange={(e) => {
            setSel(e.target.value);
            setRowPage(0);
          }}
        >
          {tables.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id}（第 {x.pageNumber} 頁，{x.rowCount}×{x.colCount}）{x.needsReview ? " ⚠ 需要核對" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm">
        <p>
          啟發式分數：<strong>{t.heuristicScore}</strong>（規則符合程度，不是經驗證的準確率）
          {t.needsReview && <span className="ml-2 rounded bg-amber-200 px-2 py-0.5 font-semibold text-amber-900">需要核對</span>}
        </p>
        <ul className="mt-1 list-inside list-disc text-slate-700">
          {t.scoreReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {t.warnings.map((w, i) => (
          <p key={i} className="mt-1 text-amber-800">⚠ {w}</p>
        ))}
      </div>
      <div className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full border-collapse text-sm" data-testid="table-preview">
          <caption className="sr-only">{t.id} 預覽</caption>
          <tbody>
            {slice.map((row, r) => (
              <tr key={r}>
                {row.map((c, k) => (
                  <td key={k} className="whitespace-pre-wrap break-words border border-slate-300 px-2 py-1 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={current} pageCount={pageCount} onChange={setRowPage} label="表格預覽分頁" />
    </div>
  );
}
