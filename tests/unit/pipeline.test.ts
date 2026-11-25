import { describe, expect, it } from "vitest";
import { AbortError, runPipeline } from "../../src/lib/pipeline/controller";
import { DEFAULT_OPTIONS } from "../../src/lib/types";
import { convertFixture, makeDeps } from "../helpers/pdf";

const allText = (r: Awaited<ReturnType<typeof convertFixture>>, page: number) =>
  r.pages[page - 1].lines.map((l) => l.text);

describe("真實 PDF 抽取（text-table.pdf）", () => {
  it("逐頁抽取全文、保留順序與頁碼", async () => {
    const r = await convertFixture("text-table.pdf");
    expect(r.totalPages).toBe(2);
    expect(r.status).toBe("complete");
    const lines = allText(r, 1);
    expect(lines[0]).toBe("Quarterly Sales Report");
    expect(lines).toContain("This report summarizes sales for the first quarter of the year.");
    expect(lines.some((l) => l.includes("Contact: Hong Kong Office, Tel +852 2345 6789."))).toBe(true);
    expect(lines.at(-1)).toBe("Page 1 of 2");
  });

  it("全文包含表格內文字，原始片段全部保留且座標為左上角原點", async () => {
    const r = await convertFixture("text-table.pdf");
    const p = r.pages[0];
    const fullText = p.lines.map((l) => l.text).join("\n");
    for (const cell of ["Widget A", "007", "=SUM(A1)", "@home", "-5", "300.00"]) expect(fullText).toContain(cell);
    const title = p.fragments.find((f) => f.text === "Quarterly Sales Report")!;
    // PDF y=780（左下角原點）→ 左上角原點約 842-780=62 再減上升部分
    expect(title.bbox.y).toBeGreaterThan(30);
    expect(title.bbox.y).toBeLessThan(62);
    expect(title.bbox.x).toBeCloseTo(50, 0);
    expect(title.source).toBe("native");
    expect(title.id).toMatch(/^P001-N\d+$/);
    expect(title.assignedLineId).toBeTruthy();
    // 每個非空片段都能追溯到行
    expect(p.fragments.every((f) => f.assignedLineId)).toBe(true);
  });

  it("識別簡單表格並輸出為多個儲存格，不改寫 007 或公式樣式文字", async () => {
    const r = await convertFixture("text-table.pdf");
    const t = r.pages[0].tables[0];
    expect(t).toBeDefined();
    expect(t.colCount).toBe(4);
    expect(t.rowCount).toBe(5);
    expect(t.rows[0]).toEqual(["Item", "Qty", "Unit Price", "Amount"]);
    expect(t.rows[2]).toEqual(["Gadget B", "007", "12.25", "85.75"]);
    expect(t.rows[4]).toEqual(["=SUM(A1)", "1", "@home", "-5"]);
    expect(t.heuristicScore).toBeGreaterThanOrEqual(45);
    expect(t.scoreReasons.length).toBeGreaterThan(0);
    // 表格片段被標記，其餘段落不在表格內
    const para = r.pages[0].fragments.find((f) => f.text.startsWith("This report"))!;
    expect(para.assignedTableId).toBeNull();
    const cell = r.pages[0].fragments.find((f) => f.text === "Widget A")!;
    expect(cell.assignedTableId).toBe(t.id);
  });

  it("相同文字出現在不同位置時不被刪除；同位置重疊文字層只在分析中排除並保留原始片段", async () => {
    const r = await convertFixture("text-table.pdf");
    const items = r.pages.flatMap((p) => p.fragments.filter((f) => f.text === "Item"));
    expect(items.length).toBeGreaterThanOrEqual(2); // p1 表格 + p2 單獨的 Item
    const p2 = r.pages[1];
    const overlaps = p2.fragments.filter((f) => f.text === "Overlap Test");
    expect(overlaps).toHaveLength(2); // 原始片段仍在
    expect(overlaps.filter((f) => f.warnings.some((w) => w.includes("重疊"))).length).toBe(1);
    expect(p2.lines.filter((l) => l.text === "Overlap Test")).toHaveLength(1);
  });

  it("關閉表格與格線時仍輸出全文", async () => {
    const r = await convertFixture("text-table.pdf", { detectTables: false, buildPageGrid: false });
    expect(r.pages[0].tables).toHaveLength(0);
    expect(r.pages[0].grid).toBeNull();
    expect(r.pages[0].lines.length).toBeGreaterThan(5);
  });

  it("產生頁面格線並保留儲存格分欄", async () => {
    const r = await convertFixture("text-table.pdf");
    const grid = r.pages[0].grid!;
    expect(grid.colCount).toBeGreaterThanOrEqual(4);
    const row = grid.rows.find((x) => x.includes("Widget A"))!;
    expect(row.filter(Boolean)).toEqual(["Widget A", "12", "5.50", "66.00"]);
  });
});

describe("版面：段落、多欄、旋轉、中文、空白", () => {
  it("普通段落不被當成表格", async () => {
    const r = await convertFixture("no-table.pdf");
    expect(r.pages[0].tables).toHaveLength(0);
    expect(r.pages[0].lines.length).toBe(9);
  });

  it("雙欄文章先按欄再按行閱讀，且不被當成表格", async () => {
    const r = await convertFixture("no-table.pdf");
    const p = r.pages[1];
    expect(p.tables).toHaveLength(0);
    const texts = p.lines.map((l) => l.text);
    expect(texts[0]).toContain("Two Column Article Title");
    const li = texts.findIndex((t) => t.startsWith("Left column line 8"));
    const ri = texts.findIndex((t) => t.startsWith("Right column line 1"));
    expect(li).toBeGreaterThan(0);
    expect(ri).toBeGreaterThan(li);
    expect(p.warnings.some((w) => w.includes("2 欄"))).toBe(true);
  });

  it("旋轉頁面：座標落在 viewport 內且文字順序正確", async () => {
    const r = await convertFixture("rotated.pdf");
    const p1 = r.pages[0];
    expect(p1.pageRotation).toBe(90);
    expect(p1.width).toBe(842);
    expect(p1.height).toBe(595);
    for (const f of p1.fragments) {
      expect(f.bbox.x).toBeGreaterThanOrEqual(-1);
      expect(f.bbox.y).toBeGreaterThanOrEqual(-1);
      expect(f.bbox.x + f.bbox.width).toBeLessThanOrEqual(842 + 1);
      expect(f.bbox.y + f.bbox.height).toBeLessThanOrEqual(595 + 1);
    }
    expect(p1.lines.map((l) => l.text)).toEqual([
      "Rotated Page Ninety",
      "First line on the rotated page.",
      "Second line on the rotated page.",
    ]);
    const p2 = r.pages[1];
    expect(p2.lines.map((l) => l.text)).toEqual(["Rotated Page One Eighty", "Upside down reading test line."]);
    const p3 = r.pages[2];
    expect(p3.lines.map((l) => l.text)).toEqual(["Vertical text from matrix"]);
    expect(p3.fragments[0].rotation).toBe(270);
  });

  it("中文與中英混排：不在中文字之間加空格，可抽取未嵌入字體的 CJK 文字", async () => {
    const r = await convertFixture("chinese.pdf");
    const lines = allText(r, 1);
    expect(lines).toContain("香港中文測試：全文轉換");
    expect(lines).toContain("简体中文测试：文字抽取与排序");
    expect(lines).toContain("Invoice No. 12345");
    expect(lines.some((l) => l.startsWith("發票編號") && l.includes("港幣 1,234.50 元"))).toBe(true);
  });

  it("空白頁標示為 empty 而非失敗", async () => {
    const r = await convertFixture("blank.pdf");
    expect(r.pages[0].status).toBe("empty");
    expect(r.pages[0].suspectedBlank).toBe(true);
    expect(r.status).toBe("complete");
  });

  it("圖片型頁面在 OCR 關閉時標示「未 OCR，可能缺少文字」，整份文件不失敗", async () => {
    const r = await convertFixture("scanned.pdf");
    const p = r.pages[0];
    expect(p.suspectedScanned).toBe(true);
    expect(p.status).toBe("skipped");
    expect(p.warnings.some((w) => w.includes("未 OCR，可能缺少文字"))).toBe(true);
    expect(r.status).toBe("partial");
  });

  it("混合文件：文字頁正常、掃描頁被標示", async () => {
    const r = await convertFixture("mixed.pdf");
    expect(r.pages[0].status).toBe("ok");
    expect(r.pages[0].suspectedScanned).toBe(false);
    expect(r.pages[1].suspectedScanned).toBe(true);
    expect(r.pages[1].status).toBe("skipped");
  });
});

describe("取消與部分頁面失敗", () => {
  it("單頁抽取失敗不影響其他頁，並記錄錯誤", async () => {
    const { deps, destroy } = await makeDeps("text-table.pdf");
    const orig = deps.source.extractNative;
    deps.source.extractNative = async (n) => {
      if (n === 1) throw new Error("模擬頁面解析錯誤");
      return orig(n);
    };
    const r = await runPipeline({ deps, options: DEFAULT_OPTIONS, fileName: "x.pdf", fileSize: 1 });
    await destroy();
    expect(r.pages[0].status).toBe("failed");
    expect(r.pages[0].error).toContain("模擬頁面解析錯誤");
    expect(r.pages[1].status).toBe("ok");
    expect(r.pages[1].lines.length).toBeGreaterThan(0);
    expect(r.status).toBe("partial");
  });

  it("表格偵測／分析錯誤只讓該頁失敗並保留其他頁", async () => {
    const { deps, destroy } = await makeDeps("text-table.pdf");
    const orig = deps.analyze;
    deps.analyze = async (input) => {
      if (input.pageNumber === 2) throw new Error("analyze boom");
      return orig(input);
    };
    const r = await runPipeline({ deps, options: DEFAULT_OPTIONS, fileName: "x.pdf", fileSize: 1 });
    await destroy();
    expect(r.pages[0].status).toBe("ok");
    expect(r.pages[1].status).toBe("failed");
  });

  it("取消時停止後續頁面並丟出 AbortError", async () => {
    const { deps, destroy } = await makeDeps("text-table.pdf");
    const controller = new AbortController();
    let extracted = 0;
    const orig = deps.source.extractNative;
    deps.source.extractNative = async (n) => {
      extracted++;
      const res = await orig(n);
      controller.abort();
      return res;
    };
    await expect(
      runPipeline({ deps, options: DEFAULT_OPTIONS, fileName: "x.pdf", fileSize: 1, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    await destroy();
    expect(extracted).toBe(1);
  });

  it("OCR 指定頁碼格式錯誤時給出具體錯誤", async () => {
    await expect(convertFixture("text-table.pdf", { ocrMode: "pages", ocrPages: "abc" })).rejects.toThrow(/OCR 頁碼格式錯誤/);
  });

  it("OCR 模型載入失敗時略過 OCR、保留原生文字並標示", async () => {
    const { deps, destroy } = await makeDeps("mixed.pdf");
    deps.createOcr = () => ({
      init: async () => {
        throw new Error("network down");
      },
      recognizePage: async () => {
        throw new Error("never");
      },
      dispose: async () => undefined,
    });
    const r = await runPipeline({ deps, options: { ...DEFAULT_OPTIONS, ocrMode: "auto" }, fileName: "m.pdf", fileSize: 1 });
    await destroy();
    expect(r.pages[1].ocrStatus).toBe("skipped");
    expect(r.pages[1].status).toBe("skipped");
    expect(r.warnings.some((w) => w.includes("OCR 模型載入失敗"))).toBe(true);
    expect(r.pages[0].status).toBe("ok");
    expect(r.status).toBe("partial");
  });
});
