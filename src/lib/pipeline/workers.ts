/**
 * Web Worker 客戶端。Worker 無法建立時（或載入失敗）自動退回主執行緒執行，並以非同步方式讓出 UI。
 * 僅限瀏覽器使用。
 */
import { AbortError, raceAbort } from "./controller";
import type { AnalyzeInput, AnalyzeOutput } from "../pdf/analyze";
import type { ConversionResult } from "../types";

interface Pending<I, O> {
  input: I;
  resolve: (o: O) => void;
  reject: (e: Error) => void;
}

export class AnalysisClient {
  private worker: Worker | null = null;
  private broken = false;
  private seq = 0;
  private pending = new Map<number, Pending<AnalyzeInput, AnalyzeOutput>>();

  private async inline(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const { analyzeFragments } = await import("../pdf/analyze");
    await new Promise((r) => setTimeout(r, 0));
    return analyzeFragments(input);
  }

  private ensureWorker(): Worker | null {
    if (this.broken || typeof Worker === "undefined") return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; output?: AnalyzeOutput; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok && e.data.output) p.resolve(e.data.output);
        else p.reject(new Error(e.data.error ?? "版面分析失敗"));
      };
      w.onerror = () => {
        // Worker 無法啟動：改在主執行緒重跑尚未完成的請求
        this.broken = true;
        w.terminate();
        this.worker = null;
        const stuck = [...this.pending.values()];
        this.pending.clear();
        for (const p of stuck) this.inline(p.input).then(p.resolve, p.reject);
      };
      this.worker = w;
      return w;
    } catch {
      this.broken = true;
      return null;
    }
  }

  analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const w = this.ensureWorker();
    if (!w) return this.inline(input);
    return new Promise<AnalyzeOutput>((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { input, resolve, reject });
      try {
        w.postMessage({ id, input });
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** 立即終止 worker 並拒絕所有等待中的請求。 */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    const stuck = [...this.pending.values()];
    this.pending.clear();
    for (const p of stuck) p.reject(new AbortError());
  }
}

/** 在 Web Worker 中建立 xlsx；失敗時退回主執行緒。取消時 terminate worker。 */
export async function buildWorkbookOffThread(result: ConversionResult, signal?: AbortSignal): Promise<ArrayBuffer> {
  const fallback = async () => {
    const { buildWorkbook } = await import("../excel/build-workbook");
    await new Promise((r) => setTimeout(r, 0));
    return buildWorkbook(result);
  };
  if (typeof Worker === "undefined") return raceAbort(fallback(), signal);

  let worker: Worker;
  try {
    worker = new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return raceAbort(fallback(), signal);
  }
  const task = new Promise<ArrayBuffer>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>) => {
      if (e.data.ok && e.data.buffer) resolve(e.data.buffer);
      else reject(new Error(e.data.error ?? "建立 Excel 失敗"));
    };
    worker.onerror = () => {
      // 無法載入 worker：改用主執行緒
      fallback().then(resolve, reject);
    };
    worker.postMessage({ id: 1, result });
  });
  try {
    return await raceAbort(task, signal);
  } finally {
    worker.terminate();
  }
}
