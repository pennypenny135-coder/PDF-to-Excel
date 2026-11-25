// OCR 煙霧測試：需要下載 Tesseract 語言模型（網路）。以 `npm run test:ocr` 單獨執行。
import { expect, test } from "@playwright/test";
import { downloadWorkbook, loadPdf } from "./helpers";

test("掃描頁 OCR：實際辨識出文字，並輸出 OCR 片段座標與信心", async ({ page }) => {
  await loadPdf(page, "scanned.pdf");
  await page.getByLabel("自動：僅疑似無文字層的頁面").check();
  await page.getByLabel("OCR 語言").selectOption("eng");
  await page.getByRole("button", { name: "開始轉換" }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 240_000 });

  const preview = page.getByTestId("text-preview");
  await expect(preview).toContainText(/INVOICE/i);
  await expect(preview).toContainText(/HELLO/i);
  await expect(page.getByTestId("stat-OCR 頁數")).toHaveText("1");

  const wb = await downloadWorkbook(page);
  const ws = wb.getWorksheet("原始片段")!;
  const rows: { text: string; src: string; x: number; y: number; w: number; h: number; conf: unknown }[] = [];
  ws.eachRow((r, i) => {
    if (i > 1)
      rows.push({
        src: String(r.getCell(4).value),
        text: String(r.getCell(5).value),
        x: Number(r.getCell(6).value),
        y: Number(r.getCell(7).value),
        w: Number(r.getCell(8).value),
        h: Number(r.getCell(9).value),
        conf: r.getCell(10).value,
      });
  });
  const ocr = rows.filter((r) => r.src === "OCR");
  expect(ocr.length).toBeGreaterThanOrEqual(3);
  const invoice = ocr.find((r) => /INVOICE/i.test(r.text));
  const hello = ocr.find((r) => /HELLO/i.test(r.text));
  expect(invoice).toBeTruthy();
  expect(hello).toBeTruthy();
  // 圖片放在頁面左上角原點座標 x 72–522、y 162–342；INVOICE 在 HELLO 之上
  expect(invoice!.x).toBeGreaterThan(60);
  expect(invoice!.y).toBeGreaterThan(150);
  expect(hello!.y).toBeGreaterThan(invoice!.y);
  expect(hello!.y + hello!.h).toBeLessThan(360);
  expect(invoice!.w).toBeGreaterThan(20);
  expect(typeof invoice!.conf).toBe("number");
});
