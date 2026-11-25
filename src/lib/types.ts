import type { OcrLanguageKey } from "./config";

export type FragmentSource = "native" | "ocr";
export type TextRotation = 0 | 90 | 180 | 270;

/** 頁面 viewport 座標（單位：PDF 點，原點在左上角，y 向下）。 */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextFragment {
  id: string;
  pageNumber: number;
  source: FragmentSource;
  text: string;
  bbox: BBox;
  /** 原始抽取索引（PDF.js textContent.items 的位置；OCR 為辨識順序） */
  rawIndex: number;
  fontName: string | null;
  fontSizeEstimate: number | null;
  /** OCR 信心（0–100，引擎提供時才有）；原生文字為 null */
  confidence: number | null;
  /** 文字方向（以 viewport 座標量化到 0/90/180/270 度） */
  rotation: TextRotation;
  assignedLineId: string | null;
  assignedTableId: string | null;
  warnings: string[];
}

export interface TextLine {
  id: string;
  pageNumber: number;
  source: FragmentSource;
  /** 該頁輸出順序中的行號（從 1 開始） */
  lineNumber: number;
  text: string;
  fragmentIds: string[];
  bbox: BBox;
  columnIndex: number;
  /** 由另一來源補充（與主要來源不重疊） */
  supplemental: boolean;
  /** OCR 行的平均信心；無資料時為 null */
  confidence: number | null;
}

export interface TableCandidate {
  id: string;
  pageNumber: number;
  source: FragmentSource;
  rows: string[][];
  rowCount: number;
  colCount: number;
  bbox: BBox;
  heuristicScore: number;
  scoreReasons: string[];
  needsReview: boolean;
  warnings: string[];
  fragmentIds: string[];
}

export interface PageGrid {
  pageNumber: number;
  source: FragmentSource;
  rows: string[][];
  colCount: number;
  /** true 表示欄數過多，已退回逐行文字 */
  fallbackLines: boolean;
  warnings: string[];
}

export type PageStatus = "ok" | "empty" | "failed" | "skipped";
export type OcrStatus = "not-run" | "done" | "failed" | "skipped";
export type PrimarySource = "native" | "ocr" | "none";

export interface PageResult {
  pageNumber: number;
  width: number;
  height: number;
  /** 頁面本身的 /Rotate 值 */
  pageRotation: number;
  status: PageStatus;
  nativeFragmentCount: number;
  ocrFragmentCount: number;
  nativeCharCount: number;
  suspectedScanned: boolean;
  suspectedBlank: boolean;
  ocrStatus: OcrStatus;
  primarySource: PrimarySource;
  primaryReason: string;
  tableCount: number;
  /** 主要來源中沒有進入任何表格的片段數 */
  unassignedCount: number;
  durationMs: number;
  warnings: string[];
  error: string | null;
  lines: TextLine[];
  tables: TableCandidate[];
  grid: PageGrid | null;
  /** 所有來源的原始片段（原生 + OCR），永不因去重而刪除 */
  fragments: TextFragment[];
}

export type OcrMode = "off" | "auto" | "pages";
export type OcrQuality = "standard" | "high";

export interface ConversionOptions {
  buildPageGrid: boolean;
  detectTables: boolean;
  ocrMode: OcrMode;
  /** 使用者輸入的頁碼字串（ocrMode = pages 時） */
  ocrPages: string;
  ocrLanguage: OcrLanguageKey;
  ocrQuality: OcrQuality;
  conservativeNumbers: boolean;
}

export type ConversionStatus = "complete" | "partial" | "cancelled";

export interface ConversionResult {
  fileName: string;
  fileSize: number;
  totalPages: number;
  options: ConversionOptions;
  status: ConversionStatus;
  startedAt: string;
  durationMs: number;
  pages: PageResult[];
  warnings: string[];
}

export type ProgressPhase =
  | "reading"
  | "extracting"
  | "layout"
  | "tables"
  | "ocr-model"
  | "ocr"
  | "excel"
  | "done"
  | "cancelled";

export interface ProgressEvent {
  phase: ProgressPhase;
  message: string;
  current: number;
  total: number;
  /** 0–1，僅在引擎有提供時 */
  fraction?: number;
}

export const DEFAULT_OPTIONS: ConversionOptions = {
  buildPageGrid: true,
  detectTables: true,
  ocrMode: "off",
  ocrPages: "",
  ocrLanguage: "chi_tra_eng",
  ocrQuality: "standard",
  conservativeNumbers: false,
};
