import ExcelJS from "exceljs";
import { expect, type Page } from "@playwright/test";
import { join } from "node:path";

export const fixture = (name: string) => join(__dirname, "..", "fixtures", name);

export async function loadPdf(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(fixture(name));
  await expect(page.getByTestId("file-info")).toBeVisible();
}

export async function convert(page: Page) {
  await page.getByRole("button", { name: "開始轉換" }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 90_000 });
}

export async function downloadWorkbook(page: Page): Promise<ExcelJS.Workbook> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下載 Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

export function sheetColumn(ws: ExcelJS.Worksheet, col: number): string[] {
  const out: string[] = [];
  ws.eachRow((row, i) => {
    if (i > 1) out.push(String(row.getCell(col).value ?? ""));
  });
  return out;
}
