# PDF 全文轉 Excel

在**瀏覽器內**把 PDF 的全文、表格與頁面版面轉成 Excel（.xlsx）。純前端、不需要 API key、資料庫、登入、後端或環境變數，可直接部署到 Vercel。

> 文件在你的瀏覽器內處理，不會上傳至我們的伺服器。首次使用 OCR 需下載辨識模型。

核心優先順序：① 盡量保留全部可抽取文字（不靜默丟棄）② 保留頁碼、來源與原始抽取記錄 ③ 盡量重建表格行列 ④ 視覺樣式。
本工具**不宣稱**準確率；表格與多欄閱讀順序都是啟發式辨識，OCR 可能有誤。

## 1. 本地啟動

需求：Node.js 20.9+（建議 22）、npm。

```bash
npm ci            # 安裝依賴；postinstall 會把 PDF.js / Tesseract 資源複製到 public/
npm run dev       # http://localhost:3000
# 或 production：
npm run build && npm run start
```

| 指令 | 說明 |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js 開發／建置／啟動 |
| `npm run lint` / `typecheck` | ESLint／TypeScript strict |
| `npm test` | Vitest 單元＋整合測試（含真實 PDF 解析、重新讀取 xlsx） |
| `npm run test:e2e` | Playwright 端對端（會先 build 並啟動 production server，埠 3100） |
| `npm run test:ocr` | OCR 煙霧測試（**需要網路下載語言模型**，見下） |
| `npm run fixtures` | 重新產生 `tests/fixtures/*.pdf` |
| `npm run tessdata` | 選用：把 OCR 語言模型下載到 `public/tessdata/` |

首次執行 e2e 需要 `npx playwright install chromium`（Linux 另需 `npx playwright install-deps chromium`）。

## 2. 部署到 Vercel（GitHub 匯入）

1. 把此 repository 推到 GitHub。
2. 在 Vercel 選 **Add New… → Project**，匯入該 repository。
3. Framework 自動偵測為 Next.js；**不需要**設定環境變數、不需要 `vercel.json`、不需要改 Build Command。
4. 按 Deploy。`npm run build` 的 `prebuild` 會自動執行 `scripts/copy-pdf-assets.mjs`，從已安裝的套件複製 PDF.js worker／CMap／標準字體／WASM 與 Tesseract worker／核心到 `public/`，版本與 `package-lock.json` 一致。

## 3. 不需 API key 或環境變數

沒有任何必要的環境變數，也沒有處理 PDF 的 API route。`/api/health` 只回傳 `{ ok: true }`，不處理文件。
（repository 內殘留的 `src/db`、`drizzle.config.json` 與 `.env` 來自起始範本，應用程式完全沒有使用；若不需要可自行刪除，並從依賴中移除 `drizzle-orm`、`pg`、`dotenv`。）

## 4. OCR 模型首次下載

OCR 預設關閉。啟用後，首次辨識時瀏覽器會下載 Tesseract 語言模型（英文約數 MB；繁／簡中文模型為數十 MB），Tesseract.js 會把模型快取在瀏覽器的 IndexedDB（只快取模型，不快取文件內容）。下載進度會顯示在進度面板；失敗時可選擇「重試」或「略過 OCR」，略過時不會讓整份文件失敗，且該頁會標示「未 OCR，可能缺少文字」。

若希望模型由自己的網站提供：`npm run tessdata`（來源與版本見 `scripts/download-tessdata.mjs`）。程式只在 `/tessdata/<lang>.traineddata.gz` 實際存在時才使用本機模型，否則改用 CDN。本機模型會增加部署體積。

## 5. 網路資源來源與用途

| 資源 | 來源 | 用途 |
| --- | --- | --- |
| 網站 HTML／JS／Web Worker | 你的部署網站 | 應用程式本身（分析與 Excel 打包在 Web Worker） |
| `/pdfjs/*`（worker、CMap、標準字體、ICC、WASM） | 建置時從 `pdfjs-dist` 複製到 `public/`，同源提供 | PDF 解析、中文字型對照 |
| `/tesseract/worker.min.js`、`/tesseract/core/*` | 建置時從 `tesseract.js`、`tesseract.js-core` 複製，同源提供 | 瀏覽器 OCR 引擎（WASM） |
| 語言模型 `*.traineddata.gz` | `https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int/`（Tesseract.js 預設），或 `public/tessdata/` | **僅在啟用 OCR 時**下載一次 |

沒有 analytics、session replay 或任何會收集文件內容的 telemetry。（Next.js 自身的匿名建置遙測可用 `npx next telemetry disable` 關閉，與文件內容無關。）

## 6. 文字型 PDF 與掃描 PDF

- **文字型 PDF**：內含文字層，直接由 PDF.js 抽取文字與座標，通常準確。
- **掃描／圖片型 PDF**：頁面只是圖片，沒有文字層，必須 OCR。OCR 結果可能有誤（字形、版面、小字、手寫、印章等）。
- 「自動 OCR」只對**疑似無文字層**的頁面執行（啟發式：幾乎沒有文字，且含圖片或大量繪圖運算）。**文字頁中夾帶的圖片文字不會自動辨識**，請用「指定頁面」OCR。
- 區分「掃描頁」與「真正空白頁」只能用啟發式判斷，不能確定。
- 原生文字與 OCR 文字**分開保存**。每頁依模式選一個主要來源輸出到「全文」（理由記錄在「處理報告」）；另一來源中**與主要來源 bbox 不重疊**的部分才作為「補充」行輸出，不會把兩份全文盲目串接。

## 7. 表格辨識與多欄閱讀順序的限制

- 表格偵測是無 AI 的啟發式規則：把文字分行 → 找連續多行共同的 x 對齊欄邊界 → 以欄數穩定度、對齊一致性、列距規律與儲存格長度評分。`heuristicScore` 與評分原因只代表規則符合程度，**不是經驗證的準確率**；低分候選標示「需要核對」。
- **目前不使用 PDF 向量線段**輔助（無框線表格與有框線表格都只靠文字座標）。
- 不自動合併跨頁表格、不自動合併儲存格（橫跨多欄時保留內容並警告）、不猜測缺失內容、不把第一列當標題。
- 跨行儲存格只在「行距明顯較小且第一欄為空」時以換行合併，其餘情況可能被拆成多列。
- 多欄偵測採保守條件（兩側都要有足夠的長文字行）；短儲存格組成的對齊不會被當成多欄。判斷不可靠時按列由上而下閱讀並顯示警告。
- 垂直書寫（直排）文字、嵌套表格、複雜合併儲存格、公式／圖表／圖片不在支援範圍。
- 頁眉、頁尾、頁碼不會被自動刪除。
- 頁面格線只是位置近似映射，不是像素級還原。

## 8. 文件不上傳的架構說明

- 所有處理在瀏覽器完成：PDF.js（解析）→ Web Worker（版面／表格分析）→ Tesseract.js（可選 OCR，另有自己的 worker）→ Web Worker 內的 ExcelJS（打包 xlsx）→ Blob + Object URL 下載。
- 專案**沒有**處理 PDF 的 API route；唯一的 route 是 `/api/health`。
- PDF 不會被存入 localStorage／IndexedDB（OCR 模型快取除外）。密碼只在記憶體中傳給 PDF.js，不寫入 log。
- E2E 測試會記錄轉換期間的所有網路請求，驗證沒有任何非同源或非 GET 請求。
- 瀏覽器仍會從網站下載程式碼、worker、WASM 與（OCR 時）語言模型，因此**不是**「首次使用即完全離線」。「無第三方 API 費用」不代表部署與流量永遠免費（以你的 Vercel 方案為準）。

## 9. 大型文件與手機

- 建議 20 MB／100 頁以內（`src/lib/config.ts` 的 `SOFT_MAX_*`）；超過時顯示警告，需勾選確認才能開始。
- 安全硬限制 100 MB／500 頁（`HARD_MAX_*`），超過直接拒絕。UI 與本文件使用同一組常數。
- 所有結果（含每頁全部片段）保存在記憶體中，長文件與 OCR 會耗用大量記憶體，手機可能失敗。OCR 逐頁、單一 worker 處理；每頁渲染面積上限 12,000,000 像素（超過自動降低縮放）；渲染完成立即釋放 canvas。
- 不提供剩餘時間預測。取消會實際 terminate Web Worker 與 OCR worker；重新開始會重新初始化。
- Excel 單格上限 32,767 字元：「全文」「原始片段」以續行保留；表格／格線的超長儲存格內容附在工作表底部「溢出內容」區。每張工作表超過 1,048,576 列時自動分表。

## 10. 如何執行全部測試

```bash
npm run typecheck
npm run lint
npm test                 # 單元＋整合（真實 fixture PDF）
npm run test:e2e         # 端對端（Chromium）
npm run test:ocr         # OCR 煙霧測試（Node 版 Tesseract + 瀏覽器版 OCR；需網路下載英文模型）
```

`test:ocr` 會從 jsDelivr 下載英文模型（Node 版快取在 `.ocr-cache/`，瀏覽器版在 Chromium profile），沒有網路時會失敗，未執行就不能視為通過。
測試 PDF 由 `scripts/generate-test-fixtures.mjs` 程式產生：英文使用 PDF 標準字體 Helvetica（不嵌入字體）；中文使用**未嵌入**的 Adobe CJK 字體名稱（STSong-Light／MSung-Light）搭配 UCS2 CMap，因此沒有任何字體授權問題；掃描頁以 `@napi-rs/canvas` 內建的 DejaVu Sans（Bitstream Vera 衍生授權）繪製成點陣圖。

## 11. 已知問題與未完成部分

- 尚未使用 PDF 向量線段輔助表格偵測。
- 沒有自動化測試涵蓋「密碼保護 PDF」：密碼流程（對話框、錯誤密碼重試）已實作，但 fixture 產生器不支援加密，僅靠程式審查與手動驗證。
- 未實測極大文件（數百頁）與真實手機瀏覽器的記憶體表現。
- 中文 OCR（`chi_tra`／`chi_sim`）流程與英文相同，但自動化 OCR 測試只涵蓋英文。
- 垂直書寫文字、複雜多欄混排與嵌套表格可能排序或分欄錯誤。
- 文字抽取受 PDF.js 限制：字型缺少 Unicode 對照的 PDF 可能抽出亂碼；此時請改用 OCR（指定頁面）。
- 取消時不保留部分結果（需重新轉換）。
- Next.js、ExcelJS 等依賴有 npm audit 警告（多為開發工具的傳遞依賴）；ExcelJS 4.4 已多年未更新。
