import { EXCEL_MAX_CELL_CHARS } from "../config";

export interface NumericCell {
  value: number;
  numFmt: string;
}

/** 明確的十進位數字：無前導 0、可有正確的千分位、可有小數。 */
const NUMBER_RE = /^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/;

/**
 * 「保守轉換數值」：只轉換格式明確的數字。
 * 保留為文字：前導 0（007）、+ 開頭、超過 15 位有效數字、含糊格式、日期、百分比、科學記號等。
 * 回傳 null 表示維持文字。
 */
export function parseConservativeNumber(text: string): NumericCell | null {
  const t = text.trim();
  if (t !== text || !NUMBER_RE.test(t)) return null;
  const plain = t.replace(/,/g, "");
  const digits = plain.replace(/[-.]/g, "");
  if (digits.length > 15) return null;
  const num = Number(plain);
  if (!Number.isFinite(num)) return null;
  if (num === 0 && plain.startsWith("-")) return null;
  const decimals = plain.includes(".") ? plain.split(".")[1].length : 0;
  const grouped = t.includes(",");
  const base = grouped ? "#,##0" : "0";
  const numFmt = decimals > 0 ? `${base}.${"0".repeat(decimals)}` : base;
  return { value: num, numFmt };
}

/** XML 1.0 不允許的控制字元，以可見的 U+FFFD 取代（原文保留在 JSON 與原始抽取結果）。 */
const ILLEGAL_XML_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function sanitizeCellText(text: string): string {
  return text.replace(ILLEGAL_XML_RE, "\uFFFD");
}

/**
 * 決定寫入 Excel 的值。預設一律為字串（保留帳號、電話、身份證等）。
 * 字串以 "="、"+"、"-"、"@" 開頭時仍是字串型別，ExcelJS 不會把純字串當作公式。
 */
export function toCellValue(text: string, conservative: boolean): string | NumericCell {
  const clean = sanitizeCellText(text);
  if (conservative) {
    const n = parseConservativeNumber(clean);
    if (n) return n;
  }
  return clean;
}

/** 依 Excel 儲存格字元上限拆分；不會切斷 surrogate pair。 */
export function splitLongText(text: string, limit = EXCEL_MAX_CELL_CHARS): string[] {
  if (limit < 2) throw new Error("limit 必須至少為 2");
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + limit, text.length);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1; // 高位 surrogate 不能落在區塊末端
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}
