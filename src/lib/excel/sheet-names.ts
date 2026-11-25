import { EXCEL_SHEET_NAME_MAX } from "../config";

/** 移除 Excel 不允許的字元（: \ / ? * [ ]）、首尾單引號，並限制 31 字元。 */
export function sanitizeSheetName(raw: string): string {
  let name = raw.replace(/[:\\/?*[\]]/g, "_").replace(/[\u0000-\u001f]/g, "").trim();
  name = name.replace(/^'+|'+$/g, "").trim();
  if (!name) name = "Sheet";
  if (name.toLowerCase() === "history") name = "History_";
  return truncate(name, EXCEL_SHEET_NAME_MAX);
}

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

/**
 * 產生不與已使用名稱（不分大小寫）重複的工作表名稱，並登記到 used。
 * 重名時在結尾加 _2、_3…，必要時縮短主體以維持 31 字元上限。
 */
export function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = sanitizeSheetName(raw);
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `_${n++}`;
    candidate = truncate(base, EXCEL_SHEET_NAME_MAX - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export const pad3 = (n: number) => String(n).padStart(3, "0");
