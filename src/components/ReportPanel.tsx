"use client";

import { useMemo, useState } from "react";
import { collectWarnings } from "@/lib/pipeline/controller";
import type { ConversionResult } from "@/lib/types";
import Pager from "./Pager";

const STATUS: Record<string, string> = { ok: "成功", empty: "空白／無文字", failed: "失敗", skipped: "略過（可能缺少文字）" };
const OCR: Record<string, string> = { "not-run": "否", done: "是", failed: "失敗", skipped: "已略過" };
const SRC: Record<string, string> = { native: "原生文字", ocr: "OCR", none: "無" };
const SIZE = 50;

export default function ReportPanel({ result }: { result: ConversionResult }) {
  const [pp, setPp] = useState(0);
  const [wp, setWp] = useState(0);
  const warnings = useMemo(() => collectWarnings(result), [result]);
  const pages = result.pages;
  const pc = Math.max(1, Math.ceil(pages.length / SIZE));
  const wc = Math.max(1, Math.ceil(warnings.length / SIZE));
  const pCur = Math.min(pp, pc - 1);
  const wCur = Math.min(wp, wc - 1);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">每頁處理報告</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="report-table">
            <caption className="sr-only">每頁處理報告</caption>
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                {["頁碼", "狀態", "原生文字數", "OCR", "主要來源", "表格數", "未進入表格片段", "耗時 (ms)"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pages.slice(pCur * SIZE, (pCur + 1) * SIZE).map((p) => (
                <tr key={p.pageNumber} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-1.5">{p.pageNumber}</td>
                  <td className="px-3 py-1.5">{STATUS[p.status]}</td>
                  <td className="px-3 py-1.5">{p.nativeFragmentCount}</td>
                  <td className="px-3 py-1.5">{OCR[p.ocrStatus]}</td>
                  <td className="px-3 py-1.5">
                    {SRC[p.primarySource]}
                    <span className="block text-xs text-slate-500">{p.primaryReason}</span>
                  </td>
                  <td className="px-3 py-1.5">{p.tableCount}</td>
                  <td className="px-3 py-1.5">{p.unassignedCount}</td>
                  <td className="px-3 py-1.5">{p.durationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pCur} pageCount={pc} onChange={setPp} label="處理報告分頁" />
      </div>
      <div>
        <h3 className="font-semibold">警告與錯誤（{warnings.length}）</h3>
        {warnings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">沒有警告。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" data-testid="warning-list">
            {warnings.slice(wCur * SIZE, (wCur + 1) * SIZE).map((w, i) => (
              <li key={i} className="rounded bg-amber-50 px-3 py-1.5 text-amber-900">
                <span className="font-medium">{w.page ? `第 ${w.page} 頁：` : "全域："}</span>
                {w.message}
              </li>
            ))}
          </ul>
        )}
        <Pager page={wCur} pageCount={wc} onChange={setWp} label="警告分頁" />
      </div>
    </div>
  );
}
