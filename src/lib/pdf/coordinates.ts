import type { BBox, TextRotation } from "../types";

export type Matrix = readonly number[];

/** 矩陣相乘，與 PDF.js Util.transform 相同：結果 = m1 × m2 */
export function multiplyMatrix(m1: Matrix, m2: Matrix): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export interface ViewportTextBox {
  bbox: BBox;
  /** 以 viewport 座標量測的字體高度（em 方塊） */
  fontSize: number;
  rotation: TextRotation;
}

/** 近似的上升／下降比例，用來由基線建立文字方塊 */
const ASCENT = 0.8;
const DESCENT = 0.2;

/**
 * 將 PDF.js 文字項目（user space 的 transform 與 width）轉為 viewport 座標（左上角原點）。
 * viewportTransform 取自 page.getViewport({ scale }).transform，已包含頁面旋轉與 y 軸翻轉。
 * 注意：不能直接使用 item.transform[5] 作為左上角 y；它是 PDF 座標系（左下角原點）的基線位置。
 */
export function textItemToViewportBox(
  itemTransform: Matrix,
  itemWidth: number,
  viewportTransform: Matrix,
): ViewportTextBox {
  const tx = multiplyMatrix(viewportTransform, itemTransform);
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]) || 1;
  const fontSize = Math.hypot(tx[2], tx[3]);
  const dirLen = Math.hypot(tx[0], tx[1]);
  // 書寫方向單位向量（viewport 座標）與「字形向上」單位向量
  const dx = dirLen > 0 ? tx[0] / dirLen : 1;
  const dy = dirLen > 0 ? tx[1] / dirLen : 0;
  const ux = fontSize > 0 ? tx[2] / fontSize : 0;
  const uy = fontSize > 0 ? tx[3] / fontSize : -1;
  const w = Math.abs(itemWidth) * scale;
  const px = tx[4];
  const py = tx[5];

  const ax = px - ux * fontSize * DESCENT;
  const ay = py - uy * fontSize * DESCENT;
  const cx = px + ux * fontSize * ASCENT;
  const cy = py + uy * fontSize * ASCENT;
  const xs = [ax, ax + dx * w, cx, cx + dx * w];
  const ys = [ay, ay + dy * w, cy, cy + dy * w];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    bbox: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
    fontSize,
    rotation: quantizeRotation((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

export function quantizeRotation(angleDeg: number): TextRotation {
  const r = ((Math.round(angleDeg / 90) * 90) % 360 + 360) % 360;
  return r as TextRotation;
}

/**
 * 將 viewport 座標的 bbox 轉換到「閱讀座標系」：該座標系中文字為水平、由左至右、行由上而下。
 * 旋轉頁面或旋轉文字需要用它來分行與排序；輸出的原始 bbox 不被修改。
 */
export function toReadingFrame(bbox: BBox, rotation: TextRotation, pageWidth: number, pageHeight: number): BBox {
  const { x, y, width: w, height: h } = bbox;
  switch (rotation) {
    case 90:
      return { x: y, y: pageWidth - (x + w), width: h, height: w };
    case 180:
      return { x: pageWidth - (x + w), y: pageHeight - (y + h), width: w, height: h };
    case 270:
      return { x: pageHeight - (y + h), y: x, width: h, height: w };
    default:
      return { ...bbox };
  }
}

export function frameSize(rotation: TextRotation, pageWidth: number, pageHeight: number) {
  return rotation === 90 || rotation === 270
    ? { width: pageHeight, height: pageWidth }
    : { width: pageWidth, height: pageHeight };
}

export function unionBBox(boxes: BBox[]): BBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function bboxIntersectionArea(a: BBox, b: BBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function bboxIoU(a: BBox, b: BBox): number {
  const inter = bboxIntersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
