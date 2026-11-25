/** 以 Blob + Object URL 觸發下載，並在稍後 revoke。僅在瀏覽器執行。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 給瀏覽器足夠時間開始下載後再釋放
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 由原始檔名建立輸出檔名，移除副檔名與不安全字元。 */
export function outputFileName(originalName: string, extension: string): string {
  const base = originalName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "output";
  return `${base.slice(0, 120)}.${extension}`;
}
