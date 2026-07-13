// Rendering pipeline. Order of operations is the whole trick: all smoothing
// happens in HEAT space; colorize only after the grayscale field is blurred.

import { GRID_W, GRID_H } from "./fire-sim";

export type PalettePreset = "inferno" | "ember" | "violet";

export interface RenderParams {
  blur: number; // internal heat softness
  outputBlur: number; // universal post-pass, px at output resolution
  hueShift: number; // degrees
  drive: number; // slow drive scalar, for saturation
  palette?: PalettePreset;
  grey?: boolean; // monochromatic mode
}

// 4-stop palettes: [background, deep, mid, core]. Below 0.16 heat stays within
// 18% of the background so bled heat maps to a DARK color (dynamic range);
// above 0.78 blends core toward white ×0.85 (white-hot only at true peaks).
const PALETTES: Record<
  PalettePreset,
  { bg: number[]; deep: number[]; mid: number[]; core: number[] }
> = {
  inferno: {
    bg: [0x24, 0x18, 0x20],
    deep: [0x8e, 0x1b, 0x0a],
    mid: [0xff, 0x2e, 0x0e],
    core: [0xff, 0x8c, 0x2e],
  },
  // Single-color flame: every stop is #FF551D (black background for contrast).
  ember: {
    bg: [0x00, 0x00, 0x00],
    deep: [0xff, 0x55, 0x1d],
    mid: [0xff, 0x55, 0x1d],
    core: [0xff, 0x55, 0x1d],
  },
  violet: {
    bg: [0x16, 0x10, 0x22],
    deep: [0x46, 0x1b, 0x7a],
    mid: [0x8e, 0x3b, 0xe0],
    core: [0xd0, 0x84, 0xff],
  },
};

const WHITE_HOT = [255 * 0.85, 255 * 0.85, 255 * 0.85];

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

// Integer hash so the grain tile is identical across instances/exports
// (determinism contract: no Math.random anywhere in the frame path).
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class FireRenderer {
  private gray: HTMLCanvasElement;
  private grayCtx: CanvasRenderingContext2D;
  private grayData: ImageData;
  private mid: HTMLCanvasElement;
  private midCtx: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
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

    this.scratch = document.createElement("canvas");
    this.scratchCtx = this.scratch.getContext("2d")!;

    // Static hash-noise grain tile.
    this.grain = document.createElement("canvas");
    this.grain.width = 128;
    this.grain.height = 128;
    const gctx = this.grain.getContext("2d")!;
    const gd = gctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const v = (hash(x, y) * 255) | 0;
        const o = (y * 128 + x) * 4;
        gd.data[o] = v;
        gd.data[o + 1] = v;
        gd.data[o + 2] = v;
        gd.data[o + 3] = 255;
      }
    }
    gctx.putImageData(gd, 0, 0);
  }

  render(heat: Float32Array, target: HTMLCanvasElement, p: RenderParams) {
    if (target.width !== OUT_W) target.width = OUT_W;
    if (target.height !== OUT_H) target.height = OUT_H;
    const ctx = target.getContext("2d")!;
    const pal = PALETTES[p.palette ?? "inferno"];

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
          mix(pal.bg, pal.deep, smoothstep(0, 0.16, h) * 0.18, out);
        } else if (h < 0.46) {
          mix(pal.deep, pal.mid, smoothstep(0.16, 0.46, h), out);
        } else if (h < 0.78) {
          mix(pal.mid, pal.core, smoothstep(0.46, 0.78, h), out);
        } else {
          mix(pal.core, WHITE_HOT, smoothstep(0.78, 1, h), out);
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

    // 5. Universal post-blur over the finished frame. Round-trip through a
    // scratch canvas whose padding ring is filled with clamp-to-edge pixels
    // (border rows/columns/corners stretched into the pad) — transparent
    // padding would fade the frame edges under blur.
    if (p.outputBlur >= 1) {
      this.postBlur(target, ctx, p.outputBlur);
    }

    // 6. Grain overlay tile (texture + kills banding in the big soft
    // gradients). Applied after the post-blur so it isn't smoothed away.
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

  private postBlur(
    target: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    blur: number,
  ) {
    const pad = Math.ceil(blur * 2);
    const sw = OUT_W + pad * 2;
    const sh = OUT_H + pad * 2;
    if (this.scratch.width !== sw) this.scratch.width = sw;
    if (this.scratch.height !== sh) this.scratch.height = sh;
    const s = this.scratchCtx;

    s.clearRect(0, 0, sw, sh);
    s.drawImage(target, pad, pad);
    // Clamp-to-edge: stretch border rows/columns into the pad ring...
    s.drawImage(target, 0, 0, OUT_W, 1, pad, 0, OUT_W, pad); // top
    s.drawImage(target, 0, OUT_H - 1, OUT_W, 1, pad, OUT_H + pad, OUT_W, pad); // bottom
    s.drawImage(target, 0, 0, 1, OUT_H, 0, pad, pad, OUT_H); // left
    s.drawImage(target, OUT_W - 1, 0, 1, OUT_H, OUT_W + pad, pad, pad, OUT_H); // right
    // ...and corner pixels into the pad corners.
    s.drawImage(target, 0, 0, 1, 1, 0, 0, pad, pad);
    s.drawImage(target, OUT_W - 1, 0, 1, 1, OUT_W + pad, 0, pad, pad);
    s.drawImage(target, 0, OUT_H - 1, 1, 1, 0, OUT_H + pad, pad, pad);
    s.drawImage(target, OUT_W - 1, OUT_H - 1, 1, 1, OUT_W + pad, OUT_H + pad, pad, pad);

    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(this.scratch, -pad, -pad);
    ctx.filter = "none";
  }
}

export const OUTPUT_SIZE = { w: OUT_W, h: OUT_H };
