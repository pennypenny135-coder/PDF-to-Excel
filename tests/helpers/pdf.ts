import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzeFragments } from "../../src/lib/pdf/analyze";
import { extractNativePage } from "../../src/lib/pdf/extract";
import { runPipeline, type PipelineDeps, type PipelineParams } from "../../src/lib/pipeline/controller";
import { DEFAULT_OPTIONS, type ConversionOptions, type ConversionResult } from "../../src/lib/types";

const root = resolve(__dirname, "..", "..");
export const fixturePath = (name: string) => join(root, "tests", "fixtures", name);

/** 開啟真實 fixture PDF（Node 版 PDF.js；CMap 與標準字體取自 node_modules）。 */
export async function openFixture(name: string) {
  const data = new Uint8Array(readFileSync(fixturePath(name)));
  const pdfRoot = join(root, "node_modules", "pdfjs-dist");
  const task = getDocument({
    data,
    cMapUrl: join(pdfRoot, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(pdfRoot, "standard_fonts") + "/",
    wasmUrl: join(pdfRoot, "wasm") + "/",
    iccUrl: join(pdfRoot, "iccs") + "/",
  });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export async function makeDeps(name: string): Promise<{ deps: PipelineDeps; destroy: () => Promise<void> }> {
  const { doc, destroy } = await openFixture(name);
  const ops = OPS as unknown as Record<string, number>;
  return {
    deps: {
      source: {
        numPages: doc.numPages,
        async extractNative(n) {
          const page = await doc.getPage(n);
          try {
            return await extractNativePage(page as never, n, ops);
          } finally {
            page.cleanup();
          }
        },
      },
      analyze: async (input) => analyzeFragments(input),
    },
    destroy: async () => {
      await destroy();
    },
  };
}

export async function convertFixture(
  name: string,
  options: Partial<ConversionOptions> = {},
  extra: Partial<PipelineParams> = {},
): Promise<ConversionResult> {
  const { deps, destroy } = await makeDeps(name);
  try {
    return await runPipeline({
      deps: extra.deps ?? deps,
      options: { ...DEFAULT_OPTIONS, ...options },
      fileName: name,
      fileSize: 0,
      ...extra,
    });
  } finally {
    await destroy();
  }
}
