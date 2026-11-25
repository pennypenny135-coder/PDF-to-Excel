// 以程式產生測試用 PDF（不含任何第三方內容）。執行：npm run fixtures
//
// 字體與授權：
// - 英文使用 PDF 標準 14 字體（Helvetica），不嵌入任何字體檔。
// - 中文使用「未嵌入」的 Adobe 預設 CJK 字體名稱（STSong-Light / MSung-Light）與 Adobe 公開的 UCS2 CMap，
//   因此 fixture 內沒有任何需要授權的字體資料；PDF.js 以專案複製的 CMap 還原 Unicode 文字。
// - 圖片頁面以 @napi-rs/canvas 內建的 DejaVu Sans（Bitstream Vera 衍生授權，可自由散布）繪製後內嵌為點陣圖。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const hexUtf16 = (s) => `<${Buffer.from(s, "utf16le").swap16().toString("hex").toUpperCase()}>`;

/** 文字指令：font = F1/F2（Helvetica 系）或 F3/F4（CJK，使用 UCS2 十六進位字串） */
function text(font, size, x, y, str, matrix) {
  const shown = font === "F3" || font === "F4" ? `${hexUtf16(str)} Tj` : `(${esc(str)}) Tj`;
  const pos = matrix ? `${matrix} Tm` : `${x} ${y} Td`;
  return `BT /${font} ${size} Tf ${pos} ${shown} ET\n`;
}

function buildPdf(pages) {
  const objs = []; // index = object number - 1
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const cjk = (name, ordering, cmap, supplement) => {
    const desc = add(
      `<< /Type /FontDescriptor /FontName /${name} /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>`,
    );
    const cid = add(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (${ordering}) /Supplement ${supplement} >> /FontDescriptor ${desc} 0 R /DW 1000 >>`,
    );
    return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /${cmap} /DescendantFonts [${cid} 0 R] >>`);
  };
  const f3 = cjk("STSong-Light", "GB1", "UniGB-UCS2-H", 2);
  const f4 = cjk("MSung-Light", "CNS1", "UniCNS-UCS2-H", 0);

  const pageIds = [];
  for (const p of pages) {
    let xobj = "";
    if (p.image) {
      const { width, height, data } = p.image;
      const stream = deflateSync(data);
      const img = add({
        dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${stream.length} >>`,
        stream,
      });
      xobj = `/XObject << /Im1 ${img} 0 R >>`;
    }
    const content = Buffer.from(p.content ?? "", "latin1");
    const cs = add({ dict: `<< /Length ${content.length} >>`, stream: content });
    const rotate = p.rotate ? ` /Rotate ${p.rotate}` : "";
    const page = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.width ?? 595} ${p.height ?? 842}]${rotate} /Contents ${cs} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> ${xobj} >> >>`,
    );
    pageIds.push(page);
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    let buf;
    if (typeof o === "string") buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1");
    else buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, "latin1"), o.stream, Buffer.from("\nendstream\nendobj\n", "latin1")]);
    parts.push(buf);
    pos += buf.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function write(name, pages) {
  const buf = buildPdf(pages);
  writeFileSync(join(outDir, name), buf);
  console.log(`  ${name} (${buf.length} bytes, ${pages.length} 頁)`);
}

// ---- 1. 文字 + 簡單表格 ----
let c = "";
c += text("F2", 18, 50, 780, "Quarterly Sales Report");
c += text("F1", 11, 50, 750, "This report summarizes sales for the first quarter of the year.");
c += text("F1", 11, 50, 736, "Item totals are shown in the table below for reference.");
c += text("F1", 11, 50, 722, "Contact: Hong Kong Office, Tel +852 2345 6789.");
const cols = [50, 250, 340, 460];
const tableRows = [
  ["Item", "Qty", "Unit Price", "Amount"],
  ["Widget A", "12", "5.50", "66.00"],
  ["Gadget B", "007", "12.25", "85.75"],
  ["Service C", "3", "100.00", "300.00"],
  ["=SUM(A1)", "1", "@home", "-5"],
];
tableRows.forEach((row, r) => {
  row.forEach((cell, k) => {
    c += text(r === 0 ? "F2" : "F1", 11, cols[k], 650 - r * 20, cell);
  });
});
c += text("F1", 9, 260, 40, "Page 1 of 2");
let c2 = "";
c2 += text("F2", 14, 50, 780, "Appendix");
c2 += text("F1", 11, 50, 750, "Item notes: all figures are unaudited and subject to change.");
c2 += text("F1", 11, 50, 736, "Overlap Test");
c2 += text("F1", 11, 50, 736, "Overlap Test"); // 同位置重複繪製（假粗體）
c2 += text("F1", 11, 300, 500, "Item");
c2 += text("F1", 9, 260, 40, "Page 2 of 2");
write("text-table.pdf", [{ content: c }, { content: c2 }]);

// ---- 2. 無表格：普通段落 + 雙欄文章 ----
let p1 = text("F2", 16, 50, 780, "Plain Paragraph Document");
for (let i = 0; i < 8; i++) {
  p1 += text("F1", 11, 50, 750 - i * 15, `Line ${i + 1}: The quick brown fox jumps over the lazy dog near the river bank today.`);
}
let p2 = text("F2", 16, 50, 780, "Two Column Article Title Spanning The Page");
for (let i = 0; i < 8; i++) {
  p2 += text("F1", 11, 50, 740 - i * 15, `Left column line ${i + 1} has enough words in it.`);
  p2 += text("F1", 11, 320, 740 - i * 15, `Right column line ${i + 1} has enough words in it too.`);
}
write("no-table.pdf", [{ content: p1 }, { content: p2 }]);

// ---- 3. 旋轉頁面 ----
let r1 = text("F2", 16, 50, 780, "Rotated Page Ninety");
r1 += text("F1", 11, 50, 750, "First line on the rotated page.");
r1 += text("F1", 11, 50, 735, "Second line on the rotated page.");
let r2 = text("F2", 16, 50, 780, "Rotated Page One Eighty");
r2 += text("F1", 11, 50, 750, "Upside down reading test line.");
// 第三頁：頁面不旋轉，但文字以 Tm 旋轉 90 度（由下往上）
let r3 = text("F1", 12, 0, 0, "Vertical text from matrix", "0 1 -1 0 300 200");
write("rotated.pdf", [{ content: r1, rotate: 90 }, { content: r2, rotate: 180 }, { content: r3 }]);

// ---- 4. 中文（未嵌入字體） ----
let z = text("F4", 16, 50, 780, "香港中文測試：全文轉換");
z += text("F3", 12, 50, 750, "简体中文测试：文字抽取与排序");
z += text("F1", 12, 50, 720, "Invoice No. 12345");
z += text("F4", 12, 50, 700, "發票編號 A-2024 金額 港幣 1,234.50 元");
write("chinese.pdf", [{ content: z }]);

// ---- 5. 圖片型（掃描）頁面 + 6. 混合 + 7. 空白 ----
function ocrImage() {
  const w = 1500;
  const h = 600;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 170px DejaVu Sans";
  ctx.fillText("INVOICE 2024", 60, 230);
  ctx.font = "bold 130px DejaVu Sans";
  ctx.fillText("HELLO OCR TEST", 60, 450);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];
    rgb[j++] = rgba[i + 1];
    rgb[j++] = rgba[i + 2];
  }
  return { width: w, height: h, data: rgb };
}
const imgPage = { content: "q 450 0 0 180 72 500 cm /Im1 Do Q\n", image: ocrImage() };
write("scanned.pdf", [imgPage]);
write("mixed.pdf", [{ content: text("F1", 12, 50, 780, "Page one has a real text layer.") + text("F1", 12, 50, 760, "Mixed document sample.") }, imgPage]);
write("blank.pdf", [{ content: "" }]);
