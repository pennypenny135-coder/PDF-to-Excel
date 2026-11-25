/**
 * 以 ExcelJS 在瀏覽器（或 Node 測試）內建立 .xlsx。不使用 fs、不建立公式／超連結／外部連結。
 * 所有抽取值預設以字串寫入；過長文字拆到後續行，不截斷。
 */
import ExcelJS from "exceljs";
import { EXCEL_MAX_CELL_CHARS, EXCEL_MAX_ROWS, OCR_LANGUAGES } from "../config";
import { collectWarnings } from "../pipeline/controller";
import type { ConversionResult, FragmentSource, PageResult, TextFragment } from "../types";
import { sanitizeCellText, splitLongText, toCellValue, type NumericCell } from "./cell-values";
import { pad3, uniqueSheetName } from "./sheet-names";

export interface BuildOptions {
  /** 每張工作表最大列數（預設為 Excel 上限；測試可調小以驗證分表） */
  maxRowsPerSheet?: number;
  /** 單一儲存格最大字元數（預設為 Excel 上限；測試可調小以驗證拆分） */
  maxCellChars?: number;
}

type Cell = string | number | null | NumericCell;

const SOURCE_LABEL: Record<FragmentSource, string> = { native: "原生文字", ocr: "OCR" };
const STATUS_LABEL = { ok: "成功", empty: "空白／無文字", failed: "失敗", skipped: "略過（可能缺少文字）" } as const;
const OCR_STATUS_LABEL = { "not-run": "否", done: "是", failed: "失敗", skipped: "已略過" } as const;
const PRIMARY_LABEL = { native: "原生文字", ocr: "OCR", none: "無" } as const;
const OCR_MODE_LABEL = { off: "關閉", auto: "自動（僅疑似無文字層頁面）", pages: "指定頁面" } as const;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
const BORDER_COLOR = { argb: "FFD0D7DE" };

function isNumeric(c: Cell): c is NumericCell {
  return typeof c === "object" && c !== null;
}

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s.length > 200 ? s.slice(0, 200) : s) w += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return w;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface SheetSpec {
  header?: string[];
  widths?: number[];
  wrapCols?: number[]; // 0-based
  freezeHeader?: boolean;
  filter?: boolean;
  note?: string;
  border?: boolean;
}

/** 將資料列寫入一或多張工作表（超過列數上限時分表）。回傳實際工作表名稱。 */
function addSheets(
  wb: ExcelJS.Workbook,
  used: Set<string>,
  baseName: string,
  rows: Cell[][],
  spec: SheetSpec,
  maxRows: number,
  fixedFirstName?: string,
): string[] {
  const perSheet = Math.max(1, maxRows - (spec.header ? 1 : 0));
  const chunks: Cell[][][] = [];
  for (let i = 0; i < rows.length || i === 0; i += perSheet) chunks.push(rows.slice(i, i + perSheet));
  const names: string[] = [];
  chunks.forEach((chunk, idx) => {
    const name = idx === 0 && fixedFirstName ? fixedFirstName : uniqueSheetName(idx === 0 ? baseName : `${baseName}_${idx + 1}`, used);
    names.push(name);
    const ws = wb.addWorksheet(name);
    const ncols = Math.max(spec.header?.length ?? 0, ...chunk.map((r) => r.length), 1);
    // 欄寬
    const widths: number[] = [];
    for (let c = 0; c < ncols; c++) {
      if (spec.widths?.[c]) widths.push(spec.widths[c]);
      else {
        let w = spec.header?.[c] ? textWidth(spec.header[c]) + 2 : 6;
        for (const r of chunk.slice(0, 500)) {
          const v = r[c];
          if (typeof v === "string") w = Math.max(w, textWidth(v) + 2);
          else if (typeof v === "number") w = Math.max(w, String(v).length + 2);
          else if (isNumeric(v)) w = Math.max(w, String(v.value).length + 2);
        }
        widths.push(Math.min(60, Math.max(6, w)));
      }
    }
    ws.columns = widths.map((width, c) => ({
      width,
      style: spec.wrapCols?.includes(c) ? { alignment: { wrapText: true, vertical: "top" as const } } : {},
    }));
    if (spec.header) {
      const hr = ws.addRow(spec.header);
      hr.font = { bold: true };
      hr.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      if (spec.freezeHeader) ws.views = [{ state: "frozen", ySplit: 1 }];
      if (spec.filter) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ncols } };
    }
    const firstDataRow = ws.rowCount + 1;
    for (const r of chunk) {
      const row = ws.addRow(r.map((c) => (isNumeric(c) ? c.value : c)));
      r.forEach((c, ci) => {
        if (isNumeric(c)) row.getCell(ci + 1).numFmt = c.numFmt;
      });
    }
    if (spec.border && chunk.length > 0) {
      for (let r = firstDataRow; r < firstDataRow + chunk.length; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= ncols; c++) {
          const side = { style: "thin" as const, color: BORDER_COLOR };
          row.getCell(c).border = { top: side, left: side, bottom: side, right: side };
        }
      }
    }
    if (spec.note && idx === 0) {
      ws.getCell(1, 1).note = spec.note;
    }
  });
  return names;
}

/** 二維字串矩陣 → 儲存格；過長儲存格拆到工作表底部的「溢出內容」區並保留位置來源。 */
function matrixToCells(
  matrix: string[][],
  conservative: boolean,
  maxChars: number,
): Cell[][] {
  const out: Cell[][] = [];
  const overflow: Cell[][] = [];
  matrix.forEach((row, r) => {
    out.push(
      row.map((text, c) => {
        const chunks = splitLongText(text, maxChars);
        if (chunks.length > 1) {
          chunks.slice(1).forEach((chunk, k) => {
            overflow.push([`[溢出內容] 第 ${r + 1} 列第 ${c + 1} 欄 續 ${k + 2}/${chunks.length}`, sanitizeCellText(chunk)]);
          });
          return sanitizeCellText(chunks[0]) + "";
        }
        const v = toCellValue(text, conservative);
        return v;
      }),
    );
  });
  if (overflow.length) {
    out.push([]);
    out.push(...overflow);
  }
  return out;
}

function lineNote(
  page: PageResult,
  lineIdx: number,
  fragById: Map<string, TextFragment>,
): string[] {
  const line = page.lines[lineIdx];
  const notes: string[] = [];
  if (line.supplemental) {
    notes.push(
      line.source === "ocr"
        ? "OCR 補充：與原生文字不重疊的內容（例如圖片中的文字），可能有誤"
        : "原生文字補充：與 OCR 主要來源不重疊",
    );
  } else if (line.source === "ocr") {
    notes.push("OCR 結果，可能有誤");
  }
  if (line.source === "ocr" && line.confidence != null) notes.push(`平均信心 ${line.confidence.toFixed(0)}`);
  const tables = new Set<string>();
  for (const id of line.fragmentIds) {
    const t = fragById.get(id)?.assignedTableId;
    if (t) tables.add(t);
  }
  if (tables.size) notes.push(`含表格內容：${[...tables].join("、")}`);
  return notes;
}

export async function buildWorkbook(result: ConversionResult, opts: BuildOptions = {}): Promise<ArrayBuffer> {
  const maxRows = opts.maxRowsPerSheet ?? EXCEL_MAX_ROWS;
  const maxChars = opts.maxCellChars ?? EXCEL_MAX_CELL_CHARS;
  const conservative = result.options.conservativeNumbers;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PDF 全文轉 Excel（瀏覽器內處理）";
  wb.created = new Date();
  wb.title = result.fileName;

  const used = new Set<string>();
  // 先保留固定名稱，避免之後的動態名稱搶用
  const nameSummary = uniqueSheetName("說明", used);
  const nameText = uniqueSheetName("全文", used);
  const nameFrag = uniqueSheetName("原始片段", used);
  const nameTables = uniqueSheetName("表格總覽", used);
  const nameReport = uniqueSheetName("處理報告", used);

  // 預先決定逐頁與表格工作表名稱
  const pageSheetNames = new Map<number, string>();
  const tableSheetNames = new Map<string, string>();
  if (result.options.buildPageGrid) {
    for (const p of result.pages) {
      if (p.grid && p.grid.rows.length > 0) pageSheetNames.set(p.pageNumber, uniqueSheetName(`Page_${pad3(p.pageNumber)}`, used));
    }
  }
  let tableOrdinal = 0;
  for (const p of result.pages) {
    for (const t of p.tables) {
      tableOrdinal++;
      tableSheetNames.set(t.id, uniqueSheetName(`Table_${pad3(tableOrdinal)}_P${pad3(p.pageNumber)}`, used));
    }
  }

  // ---------- 說明 ----------
  const warnings = collectWarnings(result);
  const counts = {
    ok: result.pages.filter((p) => p.status === "ok").length,
    empty: result.pages.filter((p) => p.status === "empty").length,
    failed: result.pages.filter((p) => p.status === "failed").length,
    skipped: result.pages.filter((p) => p.status === "skipped").length,
  };
  const o = result.options;
  const summaryRows: Cell[][] = [
    ["檔名", sanitizeCellText(result.fileName)],
    ["總頁數", result.totalPages],
    ["轉換時間", result.startedAt],
    ["處理耗時（秒）", round2(result.durationMs / 1000)],
    ["處理結果", result.status === "complete" ? "完成" : result.status === "partial" ? "部分完成" : "已取消"],
    ["頁面狀態", `成功 ${counts.ok}、空白／無文字 ${counts.empty}、失敗 ${counts.failed}、略過 ${counts.skipped}`],
    [],
    ["使用選項", ""],
    ["　建立逐頁格線工作表", o.buildPageGrid ? "是" : "否"],
    ["　識別表格", o.detectTables ? "是" : "否"],
    ["　OCR 模式", OCR_MODE_LABEL[o.ocrMode] + (o.ocrMode === "pages" ? `（${o.ocrPages}）` : "")],
    ["　OCR 語言", o.ocrMode === "off" ? "—" : OCR_LANGUAGES[o.ocrLanguage].label],
    ["　OCR 效能", o.ocrMode === "off" ? "—" : o.ocrQuality === "high" ? "較高清" : "標準"],
    ["　保守轉換數值", o.conservativeNumbers ? "是（只轉換格式明確的數字）" : "否（所有值保留為文字）"],
    [],
    ["工作表用途", ""],
    ["　全文", "每行一列，含頁碼、行號、來源與備註；表格內的文字也保留在此。"],
    ["　原始片段", "所有抽取到的非空文字片段與座標（頁面左上角為原點，單位：PDF 點）；追溯用的完整來源。"],
    ["　表格總覽", "啟發式辨識的表格候選、分數與評分原因。"],
    ["　處理報告", "每頁的狀態、來源選擇依據、警告與錯誤。"],
    ["　Page_xxx", "逐頁近似版面格線（可在轉換選項中關閉）。"],
    ["　Table_xxx_Pxxx", "表格候選的逐行逐欄輸出；來源資訊在 A1 儲存格註解中。不自動合併跨頁表格。"],
    [],
    ["重要提醒", ""],
    ["　", "表格為啟發式辨識，不保證正確；標示「需要核對」者請對照原文件。"],
    ["　", "OCR 結果可能有誤，請與原文件核對；本工具不將圖片、印章、圖表或手寫字轉為可編輯物件。"],
    ["　", "不保證 PDF 版面原樣還原；頁面格線僅為近似位置映射。"],
    ["　", "預設所有值保留為文字，以避免破壞帳號、電話與身分證號碼等資料。"],
    ["　", "文件在瀏覽器內處理，未上傳至任何伺服器。"],
    [],
    ["警告摘要", warnings.length ? `共 ${warnings.length} 則（以下列出前 40 則，完整內容請見「處理報告」與各頁備註）` : "無"],
    ...warnings.slice(0, 40).map((w): Cell[] => [w.page ? `　第 ${w.page} 頁` : "　全域", sanitizeCellText(w.message)]),
  ];
  addSheets(wb, used, "說明", summaryRows, { widths: [24, 110], wrapCols: [1] }, maxRows, nameSummary);
  const summaryWs = wb.getWorksheet(nameSummary);
  if (summaryWs) summaryWs.getColumn(1).font = { bold: true };

  // ---------- 全文 ----------
  const textRows: Cell[][] = [];
  for (const p of result.pages) {
    if (p.lines.length === 0) {
      const why =
        p.status === "failed"
          ? `此頁處理失敗：${p.error ?? ""}`
          : p.status === "skipped"
            ? "未 OCR，可能缺少文字"
            : "此頁沒有可抽取的文字（可能為空白頁）";
      textRows.push([p.pageNumber, "", "", "", sanitizeCellText(why)]);
      continue;
    }
    const fragById = new Map(p.fragments.map((f) => [f.id, f]));
    p.lines.forEach((line, i) => {
      const chunks = splitLongText(line.text, maxChars);
      const notes = lineNote(p, i, fragById);
      chunks.forEach((chunk, k) => {
        const n = [...notes];
        if (chunks.length > 1) n.unshift(`續行 ${k + 1}/${chunks.length}：單行文字超過 Excel 儲存格上限，已拆分`);
        textRows.push([p.pageNumber, line.lineNumber, SOURCE_LABEL[line.source], sanitizeCellText(chunk), n.join("；")]);
      });
    });
  }
  addSheets(wb, used, "全文", textRows, {
    header: ["頁碼", "行號", "來源", "文字", "備註"],
    widths: [8, 8, 10, 90, 40],
    wrapCols: [3, 4],
    freezeHeader: true,
    filter: true,
  }, maxRows, nameText);

  // ---------- 原始片段 ----------
  const fragRows: Cell[][] = [];
  for (const p of result.pages) {
    for (const f of p.fragments) {
      const chunks = splitLongText(f.text, maxChars);
      const baseNotes = [...f.warnings];
      if (f.assignedLineId) baseNotes.push(`所屬行：${f.assignedLineId}`);
      chunks.forEach((chunk, k) => {
        const notes = [...baseNotes];
        if (chunks.length > 1) notes.unshift(`續行 ${k + 1}/${chunks.length}：文字過長已拆分`);
        fragRows.push([
          f.id,
          f.pageNumber,
          f.rawIndex,
          SOURCE_LABEL[f.source],
          sanitizeCellText(chunk),
          round2(f.bbox.x),
          round2(f.bbox.y),
          round2(f.bbox.width),
          round2(f.bbox.height),
          f.confidence == null ? "" : round2(f.confidence),
          f.assignedTableId ?? "",
          sanitizeCellText(notes.join("；")),
        ]);
      });
    }
  }
  addSheets(wb, used, "原始片段", fragRows, {
    header: ["片段 ID", "頁碼", "原始索引", "來源", "原文", "X", "Y", "寬", "高", "信心分數", "表格 ID", "備註"],
    widths: [14, 8, 10, 10, 50, 9, 9, 9, 9, 10, 14, 50],
    wrapCols: [4, 11],
    freezeHeader: true,
    filter: true,
  }, maxRows, nameFrag);

  // ---------- 表格總覽 ----------
  const tableRows: Cell[][] = [];
  for (const p of result.pages) {
    for (const t of p.tables) {
      tableRows.push([
        t.id,
        t.pageNumber,
        tableSheetNames.get(t.id) ?? "",
        t.rowCount,
        t.colCount,
        t.heuristicScore,
        t.scoreReasons.join("；"),
        (t.needsReview ? ["需要核對"] : []).concat(t.warnings.filter((w) => !w.startsWith("需要核對"))).join("；"),
      ]);
    }
  }
  addSheets(wb, used, "表格總覽", tableRows, {
    header: ["表格 ID", "來源頁碼", "工作表名稱", "行數", "欄數", "啟發式分數", "評分原因", "警告"],
    widths: [16, 10, 20, 8, 8, 12, 60, 60],
    wrapCols: [6, 7],
    freezeHeader: true,
    filter: true,
  }, maxRows, nameTables);

  // ---------- 處理報告 ----------
  const reportRows: Cell[][] = result.pages.map((p) => [
    p.pageNumber,
    STATUS_LABEL[p.status],
    p.nativeFragmentCount,
    OCR_STATUS_LABEL[p.ocrStatus],
    PRIMARY_LABEL[p.primarySource],
    p.tableCount,
    p.unassignedCount,
    round2(p.durationMs / 1000),
    sanitizeCellText(p.warnings.join("；")),
    sanitizeCellText(p.error ?? ""),
    sanitizeCellText(p.primaryReason),
  ]);
  addSheets(wb, used, "處理報告", reportRows, {
    header: ["頁碼", "狀態", "原生文字數", "OCR 是否執行", "主要來源", "表格數", "未分類片段數（未進入表格）", "耗時（秒）", "警告", "錯誤", "來源選擇依據"],
    widths: [8, 18, 12, 14, 12, 8, 16, 10, 60, 40, 50],
    wrapCols: [8, 9, 10],
    freezeHeader: true,
    filter: true,
  }, maxRows, nameReport);

  // ---------- 逐頁格線 ----------
  if (result.options.buildPageGrid) {
    for (const p of result.pages) {
      const name = pageSheetNames.get(p.pageNumber);
      if (!name || !p.grid) continue;
      const note = [
        `第 ${p.pageNumber} 頁的近似版面格線（來源：${SOURCE_LABEL[p.grid.source]}）。`,
        "僅為位置近似映射，不是 PDF 像素級還原；完整內容以「原始片段」為準。",
        ...p.grid.warnings,
      ].join("\n");
      addSheets(wb, used, name, matrixToCells(p.grid.rows, conservative, maxChars), {
        wrapCols: Array.from({ length: p.grid.colCount }, (_, i) => i),
        note,
      }, maxRows, name);
    }
  }

  // ---------- 表格工作表 ----------
  for (const p of result.pages) {
    for (const t of p.tables) {
      const name = tableSheetNames.get(t.id);
      if (!name) continue;
      const note = [
        `表格 ${t.id}，來源第 ${t.pageNumber} 頁（${SOURCE_LABEL[t.source]}）。`,
        `啟發式分數 ${t.heuristicScore}（不是經驗證的準確率）${t.needsReview ? "，需要核對" : ""}。`,
        `位置（X, Y, 寬, 高）：${[t.bbox.x, t.bbox.y, t.bbox.width, t.bbox.height].map((v) => round2(v)).join(", ")}`,
        "第一列是原文件的第一列，未被當作標題或移除。不自動合併跨頁表格。",
        ...t.warnings,
      ].join("\n");
      addSheets(wb, used, name, matrixToCells(t.rows, conservative, maxChars), {
        wrapCols: Array.from({ length: t.colCount }, (_, i) => i),
        border: true,
        note,
      }, maxRows, name);
    }
  }

  const raw = await wb.xlsx.writeBuffer();
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
