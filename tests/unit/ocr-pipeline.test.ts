import { describe, expect, it } from "vitest";
import { runPipeline, type OcrRunner } from "../../src/lib/pipeline/controller";
import { DEFAULT_OPTIONS } from "../../src/lib/types";
import { makeDeps } from "../helpers/pdf";

/** 注入 OCR runner（非 mock 解析結果：PDF 仍由真實 PDF.js 解析，這裡只替換 OCR 引擎以測試來源選擇邏輯）。 */
function fakeOcr(words: { text: string; x0: number; y0: number; x1: number; y1: number }[], scale = 2): OcrRunner {
  return {
    init: async (onStatus) => onStatus({ status: "loading", progress: 1 }),
    recognizePage: async () => ({
      scale,
      data: {
        text: words.map((w) => w.text).join(" "),
        blocks: [{ paragraphs: [{ lines: [{ words: words.map((w) => ({ text: w.text, confidence: 90, bbox: w })) }] }] }],
      },
    }),
    dispose: async () => undefined,
  };
}

describe("原生與 OCR 來源選擇", () => {
  it("掃描頁（無文字層）：OCR 結果成為主要來源並記錄依據", async () => {
    const { deps, destroy } = await makeDeps("scanned.pdf");
    deps.createOcr = () => fakeOcr([{ text: "INVOICE", x0: 200, y0: 400, x1: 600, y1: 480 }]);
    const r = await runPipeline({ deps, options: { ...DEFAULT_OPTIONS, ocrMode: "auto" }, fileName: "s.pdf", fileSize: 1 });
    await destroy();
    const p = r.pages[0];
    expect(p.ocrStatus).toBe("done");
    expect(p.primarySource).toBe("ocr");
    expect(p.primaryReason).toContain("沒有原生文字層");
    expect(p.status).toBe("ok");
    expect(p.lines[0].text).toBe("INVOICE");
    expect(p.fragments[0].bbox).toMatchObject({ x: 100, y: 200, width: 200, height: 40 });
    expect(r.status).toBe("complete");
  });

  it("文字頁指定 OCR：原生為主；重疊的 OCR 文字不重複輸出，圖片中不重疊的 OCR 文字另行補充", async () => {
    const { deps, destroy } = await makeDeps("text-table.pdf");
    // 第一個詞與標題重疊（scale 2：頁面座標 x≈50..）；第二個詞位在頁面空白處
    deps.createOcr = () =>
      fakeOcr([
        { text: "Quarterly", x0: 100, y0: 90, x1: 260, y1: 124 },
        { text: "STAMP", x0: 800, y0: 1300, x1: 1000, y1: 1360 },
      ]);
    const r = await runPipeline({
      deps,
      options: { ...DEFAULT_OPTIONS, ocrMode: "pages", ocrPages: "1" },
      fileName: "t.pdf",
      fileSize: 1,
    });
    await destroy();
    const p1 = r.pages[0];
    expect(p1.primarySource).toBe("native");
    expect(p1.ocrStatus).toBe("done");
    expect(p1.fragments.filter((f) => f.source === "ocr")).toHaveLength(2); // 兩種來源原始片段分開保存
    const texts = p1.lines.map((l) => l.text);
    expect(texts.filter((t) => t.includes("Quarterly"))).toHaveLength(1); // 沒有重複
    const supp = p1.lines.filter((l) => l.supplemental);
    expect(supp.map((l) => l.text)).toEqual(["STAMP"]);
    expect(supp[0].source).toBe("ocr");
    expect(r.pages[1].ocrStatus).toBe("not-run");
  });

  it("OCR 失敗只影響該頁並保留警告", async () => {
    const { deps, destroy } = await makeDeps("mixed.pdf");
    deps.createOcr = () => ({
      init: async () => undefined,
      recognizePage: async () => {
        throw new Error("canvas 太大");
      },
      dispose: async () => undefined,
    });
    const r = await runPipeline({ deps, options: { ...DEFAULT_OPTIONS, ocrMode: "auto" }, fileName: "m.pdf", fileSize: 1 });
    await destroy();
    expect(r.pages[1].ocrStatus).toBe("failed");
    expect(r.pages[1].warnings.join()).toContain("canvas 太大");
    expect(r.pages[1].status).toBe("skipped");
    expect(r.pages[0].status).toBe("ok");
  });

  it("取消時會 dispose OCR runner", async () => {
    const { deps, destroy } = await makeDeps("scanned.pdf");
    const controller = new AbortController();
    let disposed = false;
    deps.createOcr = () => ({
      init: async () => undefined,
      recognizePage: () => new Promise(() => undefined), // 永遠不回應
      dispose: async () => {
        disposed = true;
      },
    });
    const run = runPipeline({
      deps,
      options: { ...DEFAULT_OPTIONS, ocrMode: "auto" },
      fileName: "s.pdf",
      fileSize: 1,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    await destroy();
    expect(disposed).toBe(true);
  });
});
