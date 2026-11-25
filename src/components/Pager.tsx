"use client";

interface Props {
  page: number; // 0-based
  pageCount: number;
  onChange: (page: number) => void;
  label: string;
}

export default function Pager({ page, pageCount, onChange, label }: Props) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className="mt-3 flex items-center gap-3 text-sm">
      <button
        className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        上一頁
      </button>
      <span aria-live="polite">
        {page + 1} / {pageCount}
      </span>
      <button
        className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
      >
        下一頁
      </button>
    </nav>
  );
}
