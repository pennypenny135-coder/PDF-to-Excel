import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseConservativeNumber, splitLongText, toCellValue } from "../../src/lib/excel/cell-values";
import { buildWorkbook } from "../../src/lib/excel/build-workbook";
import { sanitizeSheetName, uniqueSheetName } from "../../src/lib/excel/sheet-names";
import { parsePageRanges } from "../../src/lib/utils/page-ranges";
import { convertFixture } from "../helpers/pdf";

describe("工作表名稱", () => {
  it("移除非法字元並限制 31 字元", () => {
    expect(sanitizeSheetName("a:b\\c/d?e*f[g]h")).toBe("a_b_c_d_e_f_g_h");
    expect(sanitizeSheetName("'quoted'")).toBe("quoted");
    expect(sanitizeSheetName("x".repeat(60))).toHaveLength(31);
    expect(sanitizeSheetName("")).toBe("Sheet");
    expect(sanitizeSheetName("History")).toBe("History_");
  });
  it("重名（不分大小寫）加序號且仍不超過 31 字元", () => {
    const used = new Set<string>();
    const long = "y".repeat(40);
    const a = uniqueSheetName(long, used);
    const b = uniqueSheetName(long, used);
    const c = uniqueSheetName(long.toUpperCase(), used);
    expect(new Set([a, b, c].map((s) => s.toLowerCase())).size).toBe(3);
    for (const n of [a, b, c]) expect(n.length).toBeLessThanOrEqual(31);
    expect(b.endsWith("_2")).toBe(true);
  });
});

describe("數值與文字轉換", () => {
  it("預設保留文字；保守模式只轉格式明確的數字", () => {
    expect(toCellValue("1234", false)).toBe("1234");
    expect(toCellValue("1234", true)).toEqual({ value: 1234, numFmt: "0" });
    expect(toCellValue("1,234.50", true)).toEqual({ value: 1234.5, numFmt: "#,##0.00" });
    expect(toCellValue("-12.5", true)).toEqual({ value: -12.5, numFmt: "0.0" });
  });
  it("保留前導 0、電話、長整數、含糊日期與公式樣式文字為字串", () => {
    for (const t of ["007", "00123", "+85291234567", "1234567890123456789", "01/02/03", "1,23", "1e5", "=SUM(A1)", "@x", "-", "12 ", " 12", "0123.5", "5%", "-0"]) {
      expect(typeof toCellValue(t, true)).toBe("string");
    }
    expect(parseConservativeNumber("123456789012345")).not.toBeNull(); // 15 位
    expect(parseConservativeNumber("1234567890123456")).toBeNull(); // 16 位
  });
  it("過長文字拆分而非截斷，且不切斷 surrogate pair", () => {
    const text = "a".repeat(70000);
    const chunks = splitLongText(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= 32767)).toBe(true);
    expect(chunks.length).toBe(3);
    const emoji = "😀".repeat(10);
    const parts = splitLongText(emoji, 5);
    expect(parts.join("")).toBe(emoji);
    expect(parts.every((p) => p.length <= 5 && !/[\ud800-\udbff]$/.test(p))).toBe(true);
  });
});

describe("OCR 頁碼範圍", () => {
  it("解析 1,3,5-8、全形符號、去重與排序", () => {
    expect(parsePageRanges("1,3,5-8", 10).pages).toEqual([1, 3, 5, 6, 7, 8]);
    expect(parsePageRanges("8-5", 10).errors).toHaveLength(1);
    expect(parsePageRanges("3，1、2 2", 10).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges("5-12", 8)).toMatchObject({ pages: [5, 6, 7, 8], outOfRange: [9, 10, 11, 12] });
    expect(parsePageRanges("", 5).errors).toHaveLength(1);
    expect(parsePageRanges("a,0,2", 5)).toMatchObject({ pages: [2] });
    expect(parsePageRanges("a,0,2", 5).errors).toHaveLength(2);
    expect(parsePageRanges("1-99999999", 5).pages).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageRanges("1-99999999", 5).outOfRange).toHaveLength(1000);
  });
});

async function load(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("Excel 輸出（以真實 PDF 結果建立並重新讀取）", () => {
  it("包含說明／全文／原始片段／表格總覽／處理報告／Page／Table 工作表", async () => {
    const result = await convertFixture("text-table.pdf");
    const wb = await load(await buildWorkbook(result));
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["說明", "全文", "原始片段", "表格總覽", "處理報告", "Page_001", "Page_002", "Table_001_P001"]) {
      expect(names).toContain(n);
    }
    // 全文：每行一列，含表格內文字
    const text = wb.getWorksheet("全文")!;
    expect(text.getRow(1).values).toEqual([undefined, "頁碼", "行號", "來源", "文字", "備註"]);
    const textValues: string[] = [];
    text.eachRow((r, i) => i > 1 && textValues.push(String(r.getCell(4).value ?? "")));
    expect(textValues).toContain("Quarterly Sales Report");
    expect(textValues.some((t) => t.includes("Widget A"))).toBe(true);
    // 原始片段：數量與抽取結果一致
    const frag = wb.getWorksheet("原始片段")!;
    const total = result.pages.reduce((n, p) => n + p.fragments.length, 0);
    expect(frag.rowCount - 1).toBe(total);
    expect(frag.getRow(1).getCell(1).value).toBe("片段 ID");
    // 公式樣式文字仍是字串，007 保留
    const table = wb.getWorksheet("Table_001_P001")!;
    const cells: Record<string, ExcelJS.Cell> = {};
    table.eachRow((r) => r.eachCell((c) => (cells[String(c.value)] = c)));
    expect(cells["=SUM(A1)"].type).toBe(ExcelJS.ValueType.String);
    expect(cells["007"].value).toBe("007");
    expect(table.getCell(1, 1).value).toBe("Item"); // 未插入假欄名
    expect(table.getCell(1, 1).note).toBeTruthy();
    const overview = wb.getWorksheet("表格總覽")!;
    expect(overview.getCell(2, 3).value).toBe("Table_001_P001");
    const report = wb.getWorksheet("處理報告")!;
    expect(report.rowCount).toBe(3);
    expect(report.getCell(2, 2).value).toBe("成功");
  });

  it("可關閉逐頁格線；未偵測到表格仍可下載（無 Table 工作表）", async () => {
    const result = await convertFixture("no-table.pdf", { buildPageGrid: false });
    const wb = await load(await buildWorkbook(result));
    const names = wb.worksheets.map((w) => w.name);
    expect(names.some((n) => n.startsWith("Page_"))).toBe(false);
    expect(names.some((n) => n.startsWith("Table_"))).toBe(false);
    expect(wb.getWorksheet("全文")!.rowCount).toBeGreaterThan(10);
  });

  it("保守轉換數值只影響表格／格線儲存格，原始片段保持原文", async () => {
    const result = await convertFixture("text-table.pdf", { conservativeNumbers: true });
    const wb = await load(await buildWorkbook(result));
    const table = wb.getWorksheet("Table_001_P001")!;
    expect(table.getCell(2, 2).value).toBe(12);
    expect(table.getCell(3, 2).value).toBe("007");
    const frag = wb.getWorksheet("原始片段")!;
    const originals: unknown[] = [];
    frag.eachRow((r) => originals.push(r.getCell(5).value));
    expect(originals).toContain("12");
    expect(originals).toContain("007");
  });

  it("超長文字拆到後續行、超過列數上限時分表，且不截斷", async () => {
    const result = await convertFixture("text-table.pdf");
    result.pages[0].lines[1].text = "L".repeat(25);
    const wb = await load(await buildWorkbook(result, { maxCellChars: 10, maxRowsPerSheet: 12 }));
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain("全文_2");
    let joined = "";
    for (const n of names.filter((x) => x === "全文" || /^全文_\d+$/.test(x))) {
      wb.getWorksheet(n)!.eachRow((r, i) => {
        if (i > 1 && r.getCell(1).value === 1 && r.getCell(2).value === 2) joined += String(r.getCell(4).value);
      });
    }
    expect(joined).toBe("L".repeat(25));
    for (const ws of wb.worksheets) expect(ws.rowCount).toBeLessThanOrEqual(12 + 1);
    for (const ws of wb.worksheets) expect(ws.name.length).toBeLessThanOrEqual(31);
  });

  it("失敗頁面仍匯出其他頁並在處理報告寫入錯誤", async () => {
    const result = await convertFixture("text-table.pdf");
    result.pages[1].status = "failed";
    result.pages[1].error = "模擬錯誤";
    const wb = await load(await buildWorkbook(result));
    const report = wb.getWorksheet("處理報告")!;
    expect(report.getCell(3, 2).value).toBe("失敗");
    expect(report.getCell(3, 10).value).toBe("模擬錯誤");
  });
});
