"use client";

import { useState } from "react";
import { PREVIEW_PAGE_SIZE } from "@/lib/config";
import type { ConversionResult } from "@/lib/types";
import Pager from "./Pager";

export default function GridPreview({ result }: { result: ConversionResult }) {
  const pages = result.pages.filter((p) => p.grid && p.grid.rows.length > 0);
  const [sel, setSel] = useState<number | null>(null);
  const [rowPage, setRowPage] = useState(0);

  if (!result.options.buildPageGrid) return <p className="text-slate-600">本次轉換未建立逐頁格線工作表。</p>;
  if (pages.length === 0) return <p className="text-slate-600">沒有可顯示的頁面格線（沒有可抽取的文字）。</p>;

  const active = pages.find((p) => p.pageNumber === sel) ?? pages[0];
  const grid = active.grid!;
  const pageCount = Math.max(1, Math.ceil(grid.rows.length / PREVIEW_PAGE_SIZE));
  const current = Math.min(rowPage, pageCount - 1);
  const slice = grid.rows.slice(current * PREVIEW_PAGE_SIZE, (current + 1) * PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="grid-page" className="text-sm font-medium">頁面</label>
        <select
          id="grid-page"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          value={active.pageNumber}
          onChange={(e) => {
            setSel(Number(e.target.value));
            setRowPage(0);
          }}
        >
          {pages.map((p) => (
            <option key={p.pageNumber} value={p.pageNumber}>
              第 {p.pageNumber} 頁（{p.grid!.rows.length} 列 × {p.grid!.colCount} 欄）
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-sm text-slate-600">近似位置映射，不是 PDF 像素級還原。</p>
      {grid.warnings.map((w, i) => (
        <p key={i} className="mt-1 text-sm text-amber-800">⚠ {w}</p>
      ))}
      <div className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full border-collapse text-sm" data-testid="grid-preview">
          <caption className="sr-only">第 {active.pageNumber} 頁格線預覽</caption>
          <tbody>
            {slice.map((row, r) => (
              <tr key={r}>
                <th scope="row" className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-normal text-slate-500">
                  {current * PREVIEW_PAGE_SIZE + r + 1}
                </th>
                {row.map((c, k) => (
                  <td key={k} className="max-w-xs whitespace-pre-wrap break-words border border-slate-200 px-2 py-1 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={current} pageCount={pageCount} onChange={setRowPage} label="格線預覽分頁" />
    </div>
  );
}
