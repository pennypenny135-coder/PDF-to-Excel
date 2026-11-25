import PdfConverter from "@/components/PdfConverter";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">PDF 全文轉 Excel</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-700">
          逐頁抽取 PDF 文字、重建閱讀順序、以啟發式方法識別表格，並產生可下載的 .xlsx。
        </p>
        <p
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900"
          data-testid="privacy-note"
        >
          文件在你的瀏覽器內處理，不會上傳至我們的伺服器。首次使用 OCR 需下載辨識模型。
        </p>
      </header>
      <PdfConverter />
      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm leading-relaxed text-slate-600">
        <p>
          表格與多欄閱讀順序均為啟發式辨識，不保證完全正確；OCR 結果可能有誤，請與原文件核對。本工具不將圖片、印章、圖表或手寫字轉為可編輯物件。
        </p>
      </footer>
    </main>
  );
}
