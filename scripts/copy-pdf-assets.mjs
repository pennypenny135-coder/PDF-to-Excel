// 將執行期所需的 PDF.js 與 Tesseract.js 資源從 node_modules 複製到 public/，
// 確保 worker、CMap、標準字體與 WASM 的版本與已安裝套件一致。
// 由 postinstall / predev / prebuild 自動執行（Vercel build 亦同），不需要手動複製。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");

function fail(message) {
  console.error(`[copy-pdf-assets] ${message}`);
  process.exit(1);
}

function readVersion(pkg) {
  const file = join(nm, pkg, "package.json");
  if (!existsSync(file)) fail(`找不到 ${pkg}，請先執行 npm ci / npm install。`);
  return JSON.parse(readFileSync(file, "utf8")).version;
}

function copy(from, to) {
  if (!existsSync(from)) fail(`來源不存在：${from}（套件版本可能改變了目錄結構）`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

const pdfjsVersion = readVersion("pdfjs-dist");
const tesseractVersion = readVersion("tesseract.js");
const coreVersion = readVersion("tesseract.js-core");

// ---- PDF.js ----
const pdfjsOut = join(root, "public", "pdfjs");
rmSync(pdfjsOut, { recursive: true, force: true });
const pdfjsRoot = join(nm, "pdfjs-dist");
copy(join(pdfjsRoot, "build", "pdf.worker.min.mjs"), join(pdfjsOut, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  copy(join(pdfjsRoot, dir), join(pdfjsOut, dir));
}
writeFileSync(join(pdfjsOut, "VERSION.json"), JSON.stringify({ "pdfjs-dist": pdfjsVersion }, null, 2));

// ---- Tesseract.js（worker 與 LSTM 核心；語言模型不隨專案發佈）----
const tessOut = join(root, "public", "tesseract");
rmSync(tessOut, { recursive: true, force: true });
copy(join(nm, "tesseract.js", "dist", "worker.min.js"), join(tessOut, "worker.min.js"));
const coreDir = join(nm, "tesseract.js-core");
const coreFiles = readdirSync(coreDir).filter((f) => /-lstm\.wasm\.js$/.test(f) || f === "LICENSE");
if (coreFiles.length === 0) fail("tesseract.js-core 內找不到 *-lstm.wasm.js");
for (const f of coreFiles) copy(join(coreDir, f), join(tessOut, "core", f));
writeFileSync(
  join(tessOut, "VERSION.json"),
  JSON.stringify({ "tesseract.js": tesseractVersion, "tesseract.js-core": coreVersion }, null, 2),
);

console.log(
  `[copy-pdf-assets] pdfjs-dist ${pdfjsVersion}, tesseract.js ${tesseractVersion}, tesseract.js-core ${coreVersion} → public/`,
);
