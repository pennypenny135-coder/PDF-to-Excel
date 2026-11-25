/// <reference lib="webworker" />
// Excel 打包專用 Web Worker：以 ExcelJS 建立 .xlsx，完成後以 transfer 回傳 ArrayBuffer。
import { buildWorkbook } from "../lib/excel/build-workbook";
import type { ConversionResult } from "../lib/types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<{ id: number; result: ConversionResult }>) => {
  const { id, result } = event.data;
  try {
    const buffer = await buildWorkbook(result);
    ctx.postMessage({ id, ok: true, buffer }, [buffer]);
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
