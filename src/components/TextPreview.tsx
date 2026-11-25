"use client";

import { useMemo, useState } from "react";
import { PREVIEW_PAGE_SIZE } from "@/lib/config";
import type { ConversionResult } from "@/lib/types";
import Pager from "./Pager";

export default function TextPreview({ result }: { result: ConversionResult }) {
  const [filter, setFilter] = useState<number | "all">("all");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const pages = filter === "all" ? result.pages : result.pages.filter((p) => p.pageNumber === filter);
    return pages.flatMap((p) =>
      p.lines.length
        ? p.lines.map((l) => ({
            key: l.id,
            page: p.pageNumber,
            no: l.lineNumber,
            src: l.source === "ocr" ? "OCR" : "原生",
            text: l.text,
            note: l.supplemental ? "補充" : "",
          }))
        : [
            {
              key: `empty-${p.pageNumber}`,
              page: p.pageNumber,
              no: 0,
              src: "",
              text: "",
              note: p.status === "skipped" ? "未 OCR，可能缺少文字" : p.status === "failed" ? `處理失敗：${p.error ?? ""}` : "沒有可抽取的文字",
            },
          ],
    );
  }, [result, filter]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const slice = rows.slice(current * PREVIEW_PAGE_SIZE, (current + 1) * PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="text-page-filter" className="text-sm font-medium">
          頁面
        </label>
        <select
          id="text-page-filter"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value === "all" ? "all" : Number(e.target.value));
            setPage(0);
          }}
        >
          <option value="all">全部頁面</option>
          {result.pages.map((p) => (
            <option key={p.pageNumber} value={p.pageNumber}>
              第 {p.pageNumber} 頁
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-600">共 {rows.length} 行；每次顯示 {PREVIEW_PAGE_SIZE} 行</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[32rem] text-left text-sm" data-testid="text-preview">
          <caption className="sr-only">全文預覽</caption>
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">頁碼</th>
              <th scope="col" className="px-3 py-2">行號</th>
              <th scope="col" className="px-3 py-2">來源</th>
              <th scope="col" className="px-3 py-2">文字</th>
              <th scope="col" className="px-3 py-2">備註</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.key} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5">{r.page}</td>
                <td className="px-3 py-1.5">{r.no || ""}</td>
                <td className="px-3 py-1.5">{r.src}</td>
                <td className="whitespace-pre-wrap break-words px-3 py-1.5">{r.text}</td>
                <td className="px-3 py-1.5 text-slate-600">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={current} pageCount={pageCount} onChange={setPage} label="全文預覽分頁" />
    </div>
  );
}
