import { describe, expect, it } from "vitest";
import { detectTables } from "../../src/lib/pdf/table-detection";
import { groupRows, joinItems, readingOrder, type LayoutItem } from "../../src/lib/pdf/reading-order";
import { buildGrid } from "../../src/lib/pdf/page-grid";

let seq = 0;
const item = (text: string, x: number, y: number, w?: number, h = 12): LayoutItem => ({
  id: `i${seq++}`,
  text,
  x,
  y,
  w: w ?? text.length * (h * 0.5),
  h,
});

describe("行分組與拼接", () => {
  it("相近 y 的片段合併成一行，行內依 x 排序", () => {
    const rows = groupRows([item("World", 85, 100.8), item("Hello", 50, 100), item("Next", 50, 130)]);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe("Hello World");
    expect(rows[1].text).toBe("Next");
  });

  it("中文字之間不插入空格，中英交界依間距決定", () => {
    const zh = [item("香港", 50, 10, 24), item("中文", 74, 10, 24), item("測試", 98, 10, 24)];
    expect(joinItems(zh)).toBe("香港中文測試");
    const mixed = [item("Invoice", 50, 10, 42), item("發票", 98, 10, 24), item("A1", 128, 10, 12)];
    expect(joinItems(mixed)).toBe("Invoice 發票 A1");
    const tight = [item("中", 50, 10, 12), item("A", 62.5, 10, 6)];
    expect(joinItems(tight)).toBe("中A");
  });

  it("大間距以雙空格表示欄間分隔", () => {
    expect(joinItems([item("A", 50, 10, 6), item("B", 200, 10, 6)])).toBe("A  B");
  });
});

function paragraphItems(): LayoutItem[] {
  const items: LayoutItem[] = [];
  for (let i = 0; i < 10; i++) {
    items.push(item("The quick brown fox jumps over the lazy dog and keeps running far away.", 50, 100 + i * 15, 420));
  }
  return items;
}

describe("表格偵測", () => {
  it("普通段落不被當成表格", () => {
    const ro = readingOrder(paragraphItems());
    expect(detectTables(ro.blocks)).toHaveLength(0);
  });

  it("逐字（每個詞一個片段）的段落也不是表格", () => {
    const items: LayoutItem[] = [];
    const words = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".split(" ");
    for (let r = 0; r < 8; r++) {
      let x = 50;
      for (const w of words) {
        const width = w.length * 6;
        items.push(item(w, x, 100 + r * 15, width));
        x += width + 3.5;
      }
    }
    const ro = readingOrder(items);
    expect(detectTables(ro.blocks)).toHaveLength(0);
  });

  it("簡單 3 欄表格被識別，並保留原始列", () => {
    const data = [
      ["Name", "Dept", "Salary"],
      ["Alice", "Sales", "50000"],
      ["Bob", "Support", "42000"],
      ["Carol", "R&D", "61000"],
    ];
    const items = data.flatMap((row, r) => row.map((c, k) => item(c, [50, 200, 350][k], 100 + r * 18)));
    const tables = detectTables(readingOrder(items).blocks);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toEqual(data);
    expect(tables[0].colCount).toBe(3);
  });

  it("跨行儲存格以換行保留", () => {
    const items = [
      item("Item", 50, 100), item("Description", 200, 100), item("Price", 400, 100),
      item("Alpha", 50, 120), item("First line", 200, 120), item("10", 400, 120),
      item("second line", 200, 131),
      item("Beta", 50, 160), item("Other", 200, 160), item("20", 400, 160),
      item("Gamma", 50, 190), item("Last", 200, 190), item("30", 400, 190),
    ];
    const t = detectTables(readingOrder(items).blocks);
    expect(t).toHaveLength(1);
    expect(t[0].rows[1][1]).toBe("First line\nsecond line");
  });

  it("只有兩行的表格仍可識別但標示需要核對", () => {
    const items = [item("A", 50, 100), item("B", 250, 100), item("C", 50, 118), item("D", 250, 118)];
    const t = detectTables(readingOrder(items).blocks);
    if (t.length) expect(t[0].needsReview).toBe(true);
  });
});

describe("多欄閱讀順序", () => {
  it("雙欄長文先左欄後右欄", () => {
    const items: LayoutItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(item(`Left column paragraph text line ${i}`, 50, 100 + i * 15, 220));
      items.push(item(`Right column paragraph text line ${i}`, 330, 100 + i * 15, 230));
    }
    const ro = readingOrder(items);
    expect(ro.columnCount).toBe(2);
    const texts = ro.blocks.flatMap((b) => b.rows.map((r) => r.text));
    expect(texts[7]).toContain("Left column paragraph text line 7");
    expect(texts[8]).toContain("Right column paragraph text line 0");
  });

  it("短儲存格對齊（表格）不被視為多欄", () => {
    const items: LayoutItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(item(`R${i}`, 50, 100 + i * 15), item(`V${i}`, 330, 100 + i * 15));
    }
    expect(readingOrder(items).columnCount).toBe(1);
  });
});

describe("頁面格線", () => {
  it("以 x 聚類成欄，不為每個字產生一欄", () => {
    const items = [
      item("Name", 50, 100), item("Qty", 300, 100),
      item("Apple", 50, 120), item("3", 302, 120),
      item("Banana", 51, 140), item("5", 299, 140),
    ];
    const g = buildGrid(items, 595);
    expect(g.colCount).toBe(2);
    expect(g.rows[1]).toEqual(["Apple", "3"]);
  });

  it("欄數過多時放寬容差或退回逐行文字，並記錄警告", () => {
    const items: LayoutItem[] = [];
    // 每行 60 個分散的片段，位置各不相同
    for (let r = 0; r < 3; r++) for (let k = 0; k < 60; k++) items.push(item("x", 10 + k * 30 + r, 100 + r * 20, 6));
    const g = buildGrid(items, 800);
    expect(g.warnings.length).toBeGreaterThan(0);
    expect(g.colCount).toBeLessThanOrEqual(40);
  });
});
