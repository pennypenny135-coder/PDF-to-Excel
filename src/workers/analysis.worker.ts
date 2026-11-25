/// <reference lib="webworker" />
// 版面分析專用 Web Worker：CPU 密集的分行、表格偵測與格線建立不佔用 UI 執行緒。
// 只接收／回傳可 structured-clone 的純資料。
import { analyzeFragments, type AnalyzeInput } from "../lib/pdf/analyze";

interface Request {
  id: number;
  input: AnalyzeInput;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<Request>) => {
  const { id, input } = event.data;
  try {
    const output = analyzeFragments(input);
    ctx.postMessage({ id, ok: true, output });
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
