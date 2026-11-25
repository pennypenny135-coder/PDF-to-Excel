// 集中管理的限制與資源路徑。UI、README 與程式使用同一組數值。

/** 軟性建議：超過時顯示效能警告，使用者可確認繼續 */
export const SOFT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const SOFT_MAX_PAGES = 100;

/** 安全硬限制：超過時拒絕處理（避免瀏覽器記憶體耗盡） */
export const HARD_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const HARD_MAX_PAGES = 500;

/** PDF 檔頭必須出現在檔案前 N bytes 內 */
export const PDF_HEADER_SCAN_BYTES = 1024;

/** 原生文字少於此非空白字元數的頁面，視為「疑似無文字層」 */
export const SCAN_TEXT_CHAR_THRESHOLD = 3;
/** 無文字、無圖片時，繪圖運算數超過此值視為「可能為向量字形／掃描」 */
export const VECTOR_OPS_THRESHOLD = 30;

/** OCR 渲染：標準／較高清的目標縮放（相對 72 dpi 的頁面座標）*/
export const OCR_SCALE = { standard: 2.5, high: 3.5 } as const;
/** OCR 單頁最大像素面積；超過時自動降低縮放 */
export const OCR_MAX_PIXELS = 12_000_000;

export const OCR_LANGUAGES = {
  eng: { label: "英文", langs: ["eng"] },
  chi_tra_eng: { label: "繁體中文 + 英文", langs: ["chi_tra", "eng"] },
  chi_sim_eng: { label: "簡體中文 + 英文", langs: ["chi_sim", "eng"] },
} as const;
export type OcrLanguageKey = keyof typeof OCR_LANGUAGES;

/** 由 scripts/copy-pdf-assets.mjs 在 build 時複製到 public/ 的資源 */
export const PDFJS_ASSET_BASE = "/pdfjs";
export const TESSERACT_ASSET_BASE = "/tesseract";
/** 選用：scripts/download-tessdata.mjs 下載的本機語言模型目錄（不存在時改由 CDN 下載） */
export const TESSDATA_LOCAL_BASE = "/tessdata";

/** Excel 限制 */
export const EXCEL_MAX_CELL_CHARS = 32767;
export const EXCEL_MAX_ROWS = 1_048_576;
export const EXCEL_SHEET_NAME_MAX = 31;

/** 頁面格線最大欄數；超過時放寬聚類容差，仍超過則退回逐行文字 */
export const MAX_GRID_COLUMNS = 40;
/** 表格候選最大欄數 */
export const MAX_TABLE_COLUMNS = 14;
/** 表格候選最低啟發式分數 */
export const TABLE_MIN_SCORE = 45;
/** 低於此分數標示「需要核對」 */
export const TABLE_REVIEW_SCORE = 70;

/** 預覽每頁最多渲染的列數 */
export const PREVIEW_PAGE_SIZE = 100;
