// Rendering pipeline. Order of operations is the whole trick: all smoothing
// happens in HEAT space; colorize only after the grayscale field is blurred.

import { GRID_W, GRID_H } from "./fire-sim";

export interface RenderParams {
  blur: number; // internal heat softness
  outputBlur: number; // universal post-pass
  hueShift: number; // degrees
  drive: number; // slow drive scalar, for saturation
  grey?: boolean; // monochromatic mode
}

// 4-stop palette: [background, deep, mid, core].
// Single-color flame: every stop is #FF551D (black background only for contrast).
const ORANGE = [0xff, 0x55, 0x1d];
const PALETTE = {
  bg: [0x00, 0x00, 0x00],
  deep: ORANGE,
  mid: ORANGE,
  core: ORANGE,
  white: ORANGE,
};

const MID_W = 240;
const MID_H = 300;
const OUT_W = 640;
const OUT_H = 800;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(c0: number[], c1: number[], t: number, out: number[]) {
  out[0] = c0[0] + (c1[0] - c0[0]) * t;
  out[1] = c0[1] + (c1[1] - c0[1]) * t;
  out[2] = c0[2] + (c1[2] - c0[2]) * t;
}

export class FireRenderer {
  private gray: HTMLCanvasElement;
  private grayCtx: CanvasRenderingContext2D;
  private grayData: ImageData;
  private mid: HTMLCanvasElement;
  private midCtx: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement;
  private tmp: number[] = [0, 0, 0];

  constructor() {
    this.gray = document.createElement("canvas");
    this.gray.width = GRID_W;
    this.gray.height = GRID_H;
    this.grayCtx = this.gray.getContext("2d")!;
    this.grayData = this.grayCtx.createImageData(GRID_W, GRID_H);

    this.mid = document.createElement("canvas");
    this.mid.width = MID_W;
    this.mid.height = MID_H;
    this.midCtx = this.mid.getContext("2d")!;

    // Static grain tile.
    this.grain = document.createElement("canvas");
    this.grain.width = 128;
    this.grain.height = 128;
    const gctx = this.grain.getContext("2d")!;
    const gd = gctx.createImageData(128, 128);
    for (let i = 0; i < gd.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      gd.data[i] = v;
      gd.data[i + 1] = v;
      gd.data[i + 2] = v;
      gd.data[i + 3] = 255;
    }
    gctx.putImageData(gd, 0, 0);
  }

  render(heat: Float32Array, target: HTMLCanvasElement, p: RenderParams) {
    if (target.width !== OUT_W) target.width = OUT_W;
    if (target.height !== OUT_H) target.height = OUT_H;
    const ctx = target.getContext("2d")!;

    // 1. Heat -> grayscale 96x120.
    const gd = this.grayData.data;
    for (let i = 0; i < heat.length; i++) {
      const grey = Math.min(255, heat[i] * 140);
      const o = i * 4;
      gd[o] = grey;
      gd[o + 1] = grey;
      gd[o + 2] = grey;
      gd[o + 3] = 255;
    }
    this.grayCtx.putImageData(this.grayData, 0, 0);

    // 2. Upscale + blur in HEAT space to 240x300 (overscan so edges don't darken).
    this.midCtx.clearRect(0, 0, MID_W, MID_H);
    this.midCtx.filter = `blur(${2 + p.blur * 0.3}px)`;
    const over = 8;
    this.midCtx.drawImage(
      this.gray,
      -over,
      -over,
      MID_W + over * 2,
      MID_H + over * 2,
    );
    this.midCtx.filter = "none";

    // 3. Colorize per-pixel at 240x300.
    const img = this.midCtx.getImageData(0, 0, MID_W, MID_H);
    const d = img.data;
    const bg = PALETTE.bg;
    for (let y = 0; y < MID_H; y++) {
      const vign = 0.66 + 0.34 * (y / MID_H);
      for (let x = 0; x < MID_W; x++) {
        const o = (y * MID_W + x) * 4;
        const h = d[o] / 140; // back to heat space
        const out = this.tmp;
        if (p.grey) {
          // Monochromatic: black -> white ramp on smoothed heat.
          const g = Math.min(1, h) * 255;
          out[0] = g;
          out[1] = g;
          out[2] = g;
        } else if (h < 0.16) {
          mix(bg, PALETTE.deep, smoothstep(0, 0.16, h) * 0.18, out);
        } else if (h < 0.46) {
          mix(PALETTE.deep, PALETTE.mid, smoothstep(0.16, 0.46, h), out);
        } else if (h < 0.78) {
          mix(PALETTE.mid, PALETTE.core, smoothstep(0.46, 0.78, h), out);
        } else {
          mix(PALETTE.core, PALETTE.white, smoothstep(0.78, 1, h), out);
        }
        d[o] = out[0] * vign;
        d[o + 1] = out[1] * vign;
        d[o + 2] = out[2] * vign;
        d[o + 3] = 255;
      }
    }
    this.midCtx.putImageData(img, 0, 0);

    // 4. Upscale to 640x800 with light blur + saturate + hue-rotate.
    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.filter = `blur(${1.5 + p.outputBlur * 0.1}px) saturate(${
      1.2 + 0.2 * p.drive
    }) hue-rotate(${p.hueShift}deg)`;
    ctx.drawImage(this.mid, 0, 0, OUT_W, OUT_H);
    ctx.filter = "none";

    // 5. Grain overlay tile (kills banding).
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.05;
    const pattern = ctx.createPattern(this.grain, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

export const OUTPUT_SIZE = { w: OUT_W, h: OUT_H };
