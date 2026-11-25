import { describe, expect, it } from "vitest";
import { frameSize, quantizeRotation, textItemToViewportBox, toReadingFrame } from "../../src/lib/pdf/coordinates";

// pdf.js getViewport({scale:1}).transform：rotation 0 → [1,0,0,-1,0,H]
const vt0 = [1, 0, 0, -1, 0, 842];
// rotation 90（W=595,H=842 → viewport 842×595）：[0,1,1,0,0,0]
const vt90 = [0, 1, 1, 0, 0, 0];

describe("textItemToViewportBox", () => {
  it("rotation 0：左下角原點轉為左上角原點，不直接使用 transform[5]", () => {
    const r = textItemToViewportBox([12, 0, 0, 12, 50, 780], 100, vt0);
    expect(r.rotation).toBe(0);
    expect(r.fontSize).toBeCloseTo(12);
    expect(r.bbox.x).toBeCloseTo(50);
    expect(r.bbox.width).toBeCloseTo(100);
    // 基線在 y=842-780=62；方塊自基線向上 0.8em、向下 0.2em
    expect(r.bbox.y).toBeCloseTo(62 - 0.8 * 12);
    expect(r.bbox.height).toBeCloseTo(12);
  });

  it("縮放會同步放大 bbox", () => {
    const vt2 = [2, 0, 0, -2, 0, 842 * 2];
    const r = textItemToViewportBox([12, 0, 0, 12, 50, 780], 100, vt2);
    expect(r.bbox.width).toBeCloseTo(200);
    expect(r.fontSize).toBeCloseTo(24);
  });

  it("頁面旋轉 90°：文字在 viewport 中垂直，方向量化為 90", () => {
    const r = textItemToViewportBox([12, 0, 0, 12, 50, 780], 100, vt90);
    expect(r.rotation).toBe(90);
    expect(r.bbox.width).toBeCloseTo(12);
    expect(r.bbox.height).toBeCloseTo(100);
    expect(r.bbox.x).toBeGreaterThan(0);
    expect(r.bbox.y).toBeCloseTo(50);
  });

  it("文字矩陣旋轉 90° 的非旋轉頁面", () => {
    const r = textItemToViewportBox([0, 12, -12, 0, 300, 200], 60, vt0);
    expect(r.rotation).toBe(270);
    expect(r.bbox.height).toBeCloseTo(60);
  });
});

describe("閱讀座標系", () => {
  it("quantizeRotation 正規化角度", () => {
    expect(quantizeRotation(-90)).toBe(270);
    expect(quantizeRotation(179.5)).toBe(180);
    expect(quantizeRotation(3)).toBe(0);
  });

  it("toReadingFrame 讓旋轉文字變成水平、由左至右", () => {
    // 旋轉 90 的頁面：第一行文字（user-space y 較大）在 viewport 中位於右側
    const W = 842;
    const H = 595;
    const line1 = toReadingFrame({ x: 780, y: 50, width: 12, height: 200 }, 90, W, H);
    const line2 = toReadingFrame({ x: 760, y: 50, width: 12, height: 200 }, 90, W, H);
    expect(line1.width).toBe(200);
    expect(line1.height).toBe(12);
    expect(line1.y).toBeLessThan(line2.y); // 右側的行排在前面
    expect(line1.x).toBe(50);
    expect(frameSize(90, W, H)).toEqual({ width: H, height: W });
    expect(toReadingFrame({ x: 1, y: 2, width: 3, height: 4 }, 0, W, H)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
