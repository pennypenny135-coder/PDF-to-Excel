"use client";

import { OCR_LANGUAGES, type OcrLanguageKey } from "@/lib/config";
import type { ConversionOptions as Options, OcrMode, OcrQuality } from "@/lib/types";
import { parsePageRanges } from "@/lib/utils/page-ranges";

interface Props {
  options: Options;
  totalPages: number;
  disabled?: boolean;
  onChange: (o: Options) => void;
}

const MODES: { value: OcrMode; label: string; help: string }[] = [
  { value: "off", label: "關閉（預設）", help: "只處理文字型頁面；掃描頁會標示「未 OCR，可能缺少文字」。" },
  {
    value: "auto",
    label: "自動：僅疑似無文字層的頁面",
    help: "文字頁中的圖片文字不一定會自動辨識；這種情況請改用「指定頁面」。",
  },
  { value: "pages", label: "指定頁面", help: "輸入要 OCR 的頁碼，例如 1,3,5-8。" },
];

export default function ConversionOptions({ options, totalPages, disabled, onChange }: Props) {
  const set = <K extends keyof Options>(k: K, v: Options[K]) => onChange({ ...options, [k]: v });
  const pagesCheck = options.ocrMode === "pages" ? parsePageRanges(options.ocrPages, totalPages) : null;

  return (
    <fieldset disabled={disabled} className="space-y-6">
      <legend className="sr-only">轉換設定</legend>

      <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
        「全文」與「原始片段」工作表固定保留，不能關閉，以確保不會靜默丟棄任何抽取到的文字。
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={options.buildPageGrid}
            onChange={(e) => set("buildPageGrid", e.target.checked)}
          />
          <span>
            <span className="font-medium">建立逐頁格線工作表</span>
            <span className="block text-sm text-slate-600">每頁一張近似版面的工作表（位置近似映射，非像素級還原）。</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={options.detectTables}
            onChange={(e) => set("detectTables", e.target.checked)}
          />
          <span>
            <span className="font-medium">識別表格</span>
            <span className="block text-sm text-slate-600">啟發式辨識，不保證正確；低可靠度候選會標示「需要核對」。本版不自動合併跨頁表格。</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={options.conservativeNumbers}
            onChange={(e) => set("conservativeNumbers", e.target.checked)}
          />
          <span>
            <span className="font-medium">保守轉換數值</span>
            <span className="block text-sm text-slate-600">
              預設關閉，所有值保留為文字。開啟後只轉換格式明確的數字（保留前導 0、長整數與含糊日期為文字）；原始片段永遠保留原文。
            </span>
          </span>
        </label>
      </div>

      <div role="radiogroup" aria-labelledby="ocr-mode-label" className="space-y-2">
        <p id="ocr-mode-label" className="font-medium">
          OCR 模式
        </p>
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-3">
            <input
              type="radio"
              name="ocr-mode"
              className="mt-1 h-4 w-4"
              checked={options.ocrMode === m.value}
              onChange={() => set("ocrMode", m.value)}
            />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-sm text-slate-600">{m.help}</span>
            </span>
          </label>
        ))}
        {options.ocrMode === "pages" && (
          <div className="pl-7">
            <label htmlFor="ocr-pages" className="block text-sm font-medium">
              OCR 頁碼（共 {totalPages} 頁）
            </label>
            <input
              id="ocr-pages"
              type="text"
              inputMode="numeric"
              placeholder="1,3,5-8"
              value={options.ocrPages}
              onChange={(e) => set("ocrPages", e.target.value)}
              aria-invalid={!!pagesCheck && pagesCheck.errors.length > 0}
              aria-describedby="ocr-pages-msg"
              className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2"
            />
            <p id="ocr-pages-msg" className="mt-1 text-sm" role="status">
              {pagesCheck && pagesCheck.errors.length > 0 && <span className="text-red-700">{pagesCheck.errors.join("；")}</span>}
              {pagesCheck && pagesCheck.errors.length === 0 && (
                <span className="text-slate-600">
                  將對 {pagesCheck.pages.length} 頁執行 OCR
                  {pagesCheck.outOfRange.length > 0 && `（${pagesCheck.outOfRange.length} 個超出頁數的頁碼將被忽略）`}
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {options.ocrMode !== "off" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ocr-lang" className="block font-medium">
              OCR 語言
            </label>
            <select
              id="ocr-lang"
              value={options.ocrLanguage}
              onChange={(e) => set("ocrLanguage", e.target.value as OcrLanguageKey)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {(Object.keys(OCR_LANGUAGES) as OcrLanguageKey[]).map((k) => (
                <option key={k} value={k}>
                  {OCR_LANGUAGES[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ocr-quality" className="block font-medium">
              OCR 效能
            </label>
            <select
              id="ocr-quality"
              value={options.ocrQuality}
              onChange={(e) => set("ocrQuality", e.target.value as OcrQuality)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="standard">標準（較快、較省記憶體）</option>
              <option value="high">較高清（較慢、較耗記憶體）</option>
            </select>
          </div>
          <p className="text-sm text-slate-600 sm:col-span-2">
            OCR 在瀏覽器內由 Tesseract.js 執行，不使用任何外部 OCR 服務。首次使用需下載辨識模型（中文模型可能達數十 MB），之後由瀏覽器快取。OCR 結果可能有誤。
          </p>
        </div>
      )}
    </fieldset>
  );
}
