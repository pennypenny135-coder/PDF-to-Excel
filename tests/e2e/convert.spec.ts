import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convert, downloadWorkbook, loadPdf, sheetColumn } from "./helpers";

test.describe("文字型 PDF → Excel", () => {
  test("首頁顯示隱私說明，且不需要登入或 API key", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("privacy-note")).toContainText(
      "文件在你的瀏覽器內處理，不會上傳至我們的伺服器。首次使用 OCR 需下載辨識模型。",
    );
    await expect(page.getByRole("heading", { name: "PDF 全文轉 Excel" })).toBeVisible();
  });

  test("轉換、預覽全文、下載並重新讀取 xlsx；轉換期間沒有任何對外或上傳請求", async ({ page }) => {
    const requests: { method: string; url: string }[] = [];
    page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
    await loadPdf(page, "text-table.pdf");
    await expect(page.getByTestId("file-info")).toContainText("2 頁");
    await convert(page);

    await expect(page.getByTestId("text-preview")).toContainText("Quarterly Sales Report");
    await expect(page.getByTestId("text-preview")).toContainText("Widget A");
    await expect(page.getByTestId("result-status")).toHaveText("完成");

    await page.getByRole("tab", { name: "表格候選" }).click();
    await expect(page.getByTestId("table-preview")).toContainText("Gadget B");
    await expect(page.getByTestId("table-preview")).toContainText("007");
    await page.getByRole("tab", { name: "頁面格線" }).click();
    await expect(page.getByTestId("grid-preview")).toContainText("Unit Price");
    await page.getByRole("tab", { name: "處理報告" }).click();
    await expect(page.getByTestId("report-table")).toContainText("原生文字");

    const wb = await downloadWorkbook(page);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(
      expect.arrayContaining(["說明", "全文", "原始片段", "表格總覽", "處理報告", "Page_001", "Table_001_P001"]),
    );
    const fullText = sheetColumn(wb.getWorksheet("全文")!, 4);
    expect(fullText).toContain("Quarterly Sales Report");
    expect(fullText.some((t) => t.includes("Gadget B"))).toBe(true);
    const frags = sheetColumn(wb.getWorksheet("原始片段")!, 5);
    expect(frags).toEqual(expect.arrayContaining(["Quarterly Sales Report", "007", "=SUM(A1)"]));
    expect(wb.getWorksheet("Table_001_P001")!.getCell(2, 2).value).toBe("12");

    const origin = new URL(page.url()).origin;
    const external = requests.filter(
      (r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"),
    );
    expect(external).toEqual([]);
    const uploads = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
    expect(uploads).toEqual([]);
  });

  test("PDF.js worker 與 CMap 由本站提供；中文 PDF 可抽取", async ({ page }) => {
    await loadPdf(page, "chinese.pdf");
    await convert(page);
    await expect(page.getByTestId("text-preview")).toContainText("香港中文測試：全文轉換");
    await expect(page.getByTestId("text-preview")).toContainText("简体中文测试：文字抽取与排序");
    const wb = await downloadWorkbook(page);
    expect(sheetColumn(wb.getWorksheet("全文")!, 4)).toContain("香港中文測試：全文轉換");
  });

  test("旋轉頁面可轉換", async ({ page }) => {
    await loadPdf(page, "rotated.pdf");
    await convert(page);
    await expect(page.getByTestId("text-preview")).toContainText("First line on the rotated page.");
    await expect(page.getByTestId("text-preview")).toContainText("Vertical text from matrix");
  });

  test("未偵測到表格仍可下載", async ({ page }) => {
    await loadPdf(page, "no-table.pdf");
    await convert(page);
    await page.getByRole("tab", { name: "表格候選" }).click();
    await expect(page.getByText("沒有偵測到表格候選")).toBeVisible();
    const wb = await downloadWorkbook(page);
    expect(wb.worksheets.some((w) => w.name.startsWith("Table_"))).toBe(false);
    expect(sheetColumn(wb.getWorksheet("全文")!, 4).length).toBeGreaterThan(15);
  });

  test("掃描頁在 OCR 關閉時顯示「未 OCR，可能缺少文字」，仍可下載", async ({ page }) => {
    await loadPdf(page, "scanned.pdf");
    await convert(page);
    await expect(page.getByTestId("result-status")).toContainText("部分完成");
    await expect(page.getByTestId("text-preview")).toContainText("未 OCR，可能缺少文字");
    await page.getByRole("tab", { name: "處理報告" }).click();
    await expect(page.getByTestId("warning-list")).toContainText("未 OCR，可能缺少文字");
    const wb = await downloadWorkbook(page);
    const notes = sheetColumn(wb.getWorksheet("全文")!, 5);
    expect(notes.some((n) => n.includes("未 OCR，可能缺少文字"))).toBe(true);
  });

  test("下載原始結果 JSON", async ({ page }) => {
    await loadPdf(page, "text-table.pdf");
    await convert(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "下載原始結果 JSON" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.raw\.json$/);
  });
});

test.describe("錯誤處理與清理", () => {
  test("非 PDF 檔（副檔名為 .pdf）顯示具體錯誤", async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-e2e-"));
    const fake = join(dir, "fake.pdf");
    writeFileSync(fake, "this is definitely not a pdf file");
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(fake);
    await expect(page.getByTestId("error-message")).toContainText("%PDF-");
  });

  test("損壞的 PDF 顯示具體錯誤", async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-e2e-"));
    const broken = join(dir, "broken.pdf");
    writeFileSync(broken, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(broken);
    await expect(page.getByTestId("error-message")).toBeVisible();
    await expect(page.getByTestId("error-message")).not.toHaveText("Something went wrong");
  });

  test("清除所有結果會回到初始狀態", async ({ page }) => {
    await loadPdf(page, "blank.pdf");
    await convert(page);
    await page.getByRole("button", { name: "清除所有結果" }).click();
    await expect(page.getByTestId("results")).toHaveCount(0);
    await expect(page.getByTestId("file-info")).toHaveCount(0);
  });

  test("指定頁面 OCR 的頁碼格式錯誤會提示", async ({ page }) => {
    await loadPdf(page, "text-table.pdf");
    await page.getByRole("radio", { name: /^指定頁面/ }).check();
    await page.getByLabel(/OCR 頁碼/).fill("abc");
    await expect(page.getByText("無法解析")).toBeVisible();
  });

  test("OCR 模型載入失敗：可略過並保留原生文字，清楚標示", async ({ page, context }) => {
    await context.route(/\/tesseract\/core\//, (route) => route.abort());
    await loadPdf(page, "mixed.pdf");
    await page.getByLabel("自動：僅疑似無文字層的頁面").check();
    await page.getByRole("button", { name: "開始轉換" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("OCR 模型載入失敗");
    await page.getByRole("button", { name: "略過 OCR" }).click();
    await expect(page.getByTestId("results")).toBeVisible();
    await expect(page.getByTestId("result-status")).toContainText("部分完成");
    await page.getByRole("tab", { name: "處理報告" }).click();
    await expect(page.getByTestId("warning-list")).toContainText("OCR 模型載入失敗");
    await expect(page.getByTestId("warning-list")).toContainText("可能缺少文字");
  });

  test("取消會實際終止 OCR 初始化，之後可重新開始", async ({ page, context }) => {
    // 讓 OCR 核心載入永遠卡住，模擬模型下載中
    await context.route(/\/tesseract\/core\//, () => new Promise(() => undefined));
    await loadPdf(page, "scanned.pdf");
    await page.getByLabel("自動：僅疑似無文字層的頁面").check();
    await page.getByRole("button", { name: "開始轉換" }).click();
    await expect(page.getByTestId("progress-message")).toContainText("OCR", { timeout: 30_000 });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByText("已取消，未保留部分結果。")).toBeVisible();
    await expect(page.getByTestId("progress-panel")).toHaveCount(0);
    await page.getByLabel("關閉（預設）").check();
    await page.getByRole("button", { name: "重新轉換" }).click();
    await expect(page.getByTestId("results")).toBeVisible();
  });
});
