// 選用：把 Tesseract 語言模型下載到 public/tessdata/，讓 OCR 不必在使用者首次使用時從 CDN 下載。
// 用法：npm run tessdata            （eng、chi_tra、chi_sim）
//       npm run tessdata -- eng     （只下載指定語言）
//
// 來源與版本：
//   https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int/<lang>.traineddata.gz
//   這是 Tesseract.js 在 LSTM-only 模式下預設使用的同一份模型（tessdata_best 的整數量化版本，Apache-2.0）。
// 部署：public/tessdata 已列入 .gitignore；若要隨網站發佈，請在 build 流程中執行本腳本（會增加部署體積）。
// 程式只在 /tessdata/<lang>.traineddata.gz 實際存在時才使用本機模型，否則自動改用 CDN。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_DIR = "4.0.0_best_int";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "tessdata");
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ["eng", "chi_tra", "chi_sim"];

mkdirSync(outDir, { recursive: true });
let failed = 0;

for (const lang of langs) {
  if (!/^[a-z_]+$/.test(lang)) {
    console.error(`略過不合法的語言代碼：${lang}`);
    failed++;
    continue;
  }
  const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${VERSION_DIR}/${lang}.traineddata.gz`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // gzip 魔術位元組 1f 8b；避免把錯誤頁面當成模型存檔
    if (buf.length < 1024 || buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error("下載內容不是有效的 gzip 檔");
    writeFileSync(join(outDir, `${lang}.traineddata.gz`), buf);
    console.log(`✓ ${lang}  ${(buf.length / 1024 / 1024).toFixed(1)} MB  ← ${url}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${lang} 下載失敗：${e instanceof Error ? e.message : e}\n  來源：${url}`);
  }
}
if (failed) {
  console.error(`${failed} 個語言下載失敗。未下載成功的語言會在執行時改由 CDN 取得。`);
  process.exit(1);
}
