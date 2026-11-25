// 健康檢查：不連接資料庫，也不處理任何文件。PDF 只在瀏覽器內處理。
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true });
}
