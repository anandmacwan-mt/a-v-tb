// Stable-fluids-family scalar heat solver. The only state is the heat field;
// velocity is computed analytically each step (buoyancy + divergence-free curl
// noise), which keeps it cheap and deterministic.

import type { Drive } from "./audio-analysis";

export interface FireParams {
  intensity: number; // emitter heat
  turbulence: number; // curl amount
  rise: number; // buoyancy / updraft
  breath: number; // idle cycle rate multiplier
  reactivity: number; // audio -> motion gain
  vocalFocus: number; // 0 = full-mix drive, 1 = vocal drive
}

export const DEFAULT_PARAMS: FireParams = {
  intensity: 1,
  turbulence: 1,
  rise: 0.6,
  breath: 1,
  reactivity: 1,
  vocalFocus: 0.7,
};

export const GRID_W = 96;
export const GRID_H = 120;

const H = 1 / 60; // fixed sim timestep

// --- deterministic hash-based value noise ---
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 2-octave fbm.
function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.6 + vnoise(x * 2, y * 2) * 0.3;
}

function gauss(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-0.5 * d * d);
}

export class FireSim {
  heat = new Float32Array(GRID_W * GRID_H);
  private tmp = new Float32Array(GRID_W * GRID_H);
  private acc = 0;
  private t = 0;
  private scroll = 0;
  private seed: number;

  constructor(seed = Math.random() * 1000) {
    this.seed = seed;
  }

  reset() {
    this.heat.fill(0);
    this.tmp.fill(0);
    this.acc = 0;
    this.t = 0;
    this.scroll = 0;
  }

  private sampleHeat(x: number, y: number): number {
    if (x < 0) x = 0;
    else if (x > GRID_W - 1) x = GRID_W - 1;
    if (y < 0) y = 0;
    else if (y > GRID_H - 1) y = GRID_H - 1;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(GRID_W - 1, x0 + 1);
    const y1 = Math.min(GRID_H - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const h = this.heat;
    const a = h[y0 * GRID_W + x0];
    const b = h[y0 * GRID_W + x1];
    const c = h[y1 * GRID_W + x0];
    const d = h[y1 * GRID_W + x1];
    return (
      a * (1 - fx) * (1 - fy) +
      b * fx * (1 - fy) +
      c * (1 - fx) * fy +
      d * fx * fy
    );
  }

  private step(drive: Drive, p: FireParams) {
    const driveScalar =
      p.vocalFocus * drive.slowVocal + (1 - p.vocalFocus) * drive.slowLevel;
    const pulse = drive.vocal;
    const baseRise =
      (5 + 13 * p.rise) * (0.75 + 0.45 * driveScalar * p.reactivity);
    // scroll = t·baseRise·0.06, integrated so a moving drive can't jump the field.
    this.scroll += baseRise * 0.06 * H;
    const scroll = this.scroll;
    const cool = Math.exp(-(0.5 + 0.22 * (1 - driveScalar)) * H);
    const eps = 0.06;

    // Velocity + semi-Lagrangian advection + cooling.
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const idx = y * GRID_W + x;
        const nx = x * 0.055;
        const ny = y * 0.055 - scroll;
        // curl of scalar potential phi -> divergence-free velocity.
        const dphidy =
          (fbm(nx, ny + eps) - fbm(nx, ny - eps)) / (2 * eps);
        const dphidx =
          (fbm(nx + eps, ny) - fbm(nx - eps, ny)) / (2 * eps);
        const curlX = dphidy * 20 * p.turbulence;
        const curlY = -dphidx * 20 * p.turbulence;
        const vx = curlX;
        const vy = -(baseRise + 18 * p.rise * this.heat[idx]) + curlY;
        const sampled = this.sampleHeat(x - vx * H, y - vy * H);
        this.tmp[idx] = sampled * cool;
      }
    }
    this.heat.set(this.tmp);

    // Emitters into bottom 3 rows.
    this.emit(drive, p, driveScalar, pulse);

    // Separable 3-tap diffusion + clamp.
    this.diffuse(0.22);
  }

  private emit(drive: Drive, p: FireParams, driveScalar: number, pulse: number) {
    const t = this.t;
    const breathOsc =
      Math.sin((2 * Math.PI * t) / (11 / Math.max(0.1, p.breath))) * 0.5 + 0.5;
    const idle = 0.14 + 0.1 * breathOsc;
    const base =
      p.intensity *
      Math.min(
        1.05,
        idle + p.reactivity * (0.5 * drive.bass + 0.55 * driveScalar),
      );

    // Five roaming Gaussian sources.
    const src: { center: number; width: number; strength: number }[] = [];
    for (let k = 0; k < 5; k++) {
      const s = this.seed + k * 37.1;
      const center = 0.27 + 0.46 * vnoise(s, t * 0.1);
      const width = 0.06 + 0.07 * vnoise(s + 11, t * 0.13);
      const strength = 0.35 + 0.65 * vnoise(s + 23, t * 0.09);
      src.push({ center, width, strength });
    }

    // Beat flare column jumps every 0.5 s window.
    const window = Math.floor(t / 0.5);
    const beatCol = vnoise(this.seed + window * 3.7, 0.5);
    // Vocal core wandering center.
    const vocalCenter = 0.3 + 0.4 * vnoise(this.seed + 5, t * 0.05);

    const rows = [GRID_H - 1, GRID_H - 2, GRID_H - 3];
    for (let x = 0; x < GRID_W; x++) {
      const nx = x / (GRID_W - 1);
      let s = 0;
      for (const g of src) s += gauss(nx, g.center, g.width) * g.strength;
      const ragged = 0.62 + 0.46 * vnoise(x * 0.14, t * 0.3);
      s *= ragged * base;
      s += gauss(nx, beatCol, 0.03) * p.reactivity * drive.beat * 0.8;
      s +=
        gauss(nx, vocalCenter, 0.15) *
        (1 + 0.5 * drive.flux + 0.35 * pulse) *
        base *
        0.42;
      for (const row of rows) {
        const idx = row * GRID_W + x;
        if (s > this.heat[idx]) this.heat[idx] = s;
      }
    }
  }

  private diffuse(amount: number) {
    const h = this.heat;
    const tmp = this.tmp;
    // horizontal
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const idx = y * GRID_W + x;
        const l = h[idx - (x > 0 ? 1 : 0)];
        const r = h[idx + (x < GRID_W - 1 ? 1 : 0)];
        tmp[idx] = h[idx] * (1 - amount) + (l + r) * 0.5 * amount;
      }
    }
    // vertical
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const idx = y * GRID_W + x;
        const u = tmp[idx - (y > 0 ? GRID_W : 0)];
        const d = tmp[idx + (y < GRID_H - 1 ? GRID_W : 0)];
        let v = tmp[idx] * (1 - amount) + (u + d) * 0.5 * amount;
        if (v < 0) v = 0;
        else if (v > 1.8) v = 1.8;
        h[idx] = v;
      }
    }
  }

  // Advance by dt seconds in fixed H substeps (drive held across substeps).
  advance(dt: number, drive: Drive, p: FireParams) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= H && steps < 6) {
      this.step(drive, p);
      this.acc -= H;
      this.t += H;
      steps++;
    }
    if (steps === 6) this.acc = 0; // shed backlog
  }
}
