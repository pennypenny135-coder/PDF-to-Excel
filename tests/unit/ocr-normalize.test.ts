import { describe, expect, it } from "vitest";
import { normalizeOcrPage } from "../../src/lib/ocr/normalize";
import { computeOcrScale } from "../../src/lib/ocr/render";

const ctx = { pageNumber: 2, renderScale: 2, pageWidth: 600, pageHeight: 800 };

describe("OCR 正規化", () => {
  it("由 blocks 的字詞取得 bbox（像素 → 頁面座標）與信心", () => {
    const r = normalizeOcrPage(
      {
        text: "Hello World",
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "Hello World",
                    words: [
                      { text: "Hello", confidence: 96.5, bbox: { x0: 100, y0: 200, x1: 300, y1: 260 } },
                      { text: "World", confidence: 91, bbox: { x0: 320, y0: 200, x1: 520, y1: 260 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      ctx,
    );
    expect(r.granularity).toBe("word");
    expect(r.fragments).toHaveLength(2);
    expect(r.fragments[0]).toMatchObject({
      id: "P002-O0",
      source: "ocr",
      text: "Hello",
      confidence: 96.5,
      bbox: { x: 50, y: 100, width: 100, height: 30 },
    });
    expect(r.fragments[0].warnings[0]).toContain("OCR");
  });

  it("沒有 words 時退回行 bbox；confidence 缺失時為 null", () => {
    const r = normalizeOcrPage(
      { blocks: [{ paragraphs: [{ lines: [{ text: "Only line", words: undefined, bbox: { x0: 0, y0: 0, x1: 200, y1: 40 } }] }] }] },
      ctx,
    );
    expect(r.granularity).toBe("line");
    expect(r.fragments[0].confidence).toBeNull();
  });

  it("blocks 為 null 時解析 TSV；-1 信心視為 null", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t40\t80\t100\t30\t88.2\tInvoice",
      "5\t1\t1\t1\t1\t2\t160\t80\t80\t30\t-1\t2024",
    ].join("\n");
    const r = normalizeOcrPage({ blocks: null, tsv, text: "Invoice 2024" }, ctx);
    expect(r.granularity).toBe("tsv-word");
    expect(r.fragments.map((f) => f.text)).toEqual(["Invoice", "2024"]);
    expect(r.fragments[1].confidence).toBeNull();
    expect(r.fragments[0].bbox.x).toBe(20);
  });

  it("只有純文字時標示 bbox 為近似值，沒有任何輸出時回報", () => {
    const t = normalizeOcrPage({ blocks: null, tsv: null, text: "a\nb" }, ctx);
    expect(t.granularity).toBe("text-only");
    expect(t.warnings.join()).toContain("座標");
    expect(normalizeOcrPage({ text: "  " }, ctx).fragments).toHaveLength(0);
  });

  it("限制 OCR 渲染像素面積", () => {
    expect(computeOcrScale(595, 842, "standard")).toBe(2.5);
    const huge = computeOcrScale(5000, 5000, "high");
    expect(5000 * huge * 5000 * huge).toBeLessThanOrEqual(12_000_000 + 1);
  });
});
