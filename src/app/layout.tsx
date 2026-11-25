import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF 全文轉 Excel｜瀏覽器內處理",
  description:
    "在瀏覽器內把 PDF 全文、表格與頁面版面轉成 Excel（.xlsx）。文件不會上傳至伺服器；可選本機 OCR。",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant-HK">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
