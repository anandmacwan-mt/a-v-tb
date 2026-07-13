// Precomputed audio feature analysis.
// Decodes the whole track and extracts per-frame drive signals that can be
// sampled at any time t via linear interpolation (enables seek-based export).
//
// The channel set mirrors TouchDesigner's audio-analysis palette: low/mid/high
// band levels, kick/snare onset triggers, and a smoothed envelope — all
// dB-scaled and normalized against the track's own dynamics, so quiet passages
// still register and loud choruses don't pin every channel at 1.

export interface Drive {
  low: number; // 20–150 Hz band level (kick / bass fundamentals)
  mid: number; // 150–2000 Hz (body, vocals, snare)
  high: number; // 2–16 kHz (cymbals, air)
  kick: number; // low-band onset trigger (adaptive)
  snare: number; // mid-band onset trigger (adaptive)
  envelope: number; // smoothed full-mix loudness
  vocal: number; // fast vocal envelope ("pulse")
  flux: number; // vocal-band onsets (consonants)
  slowVocal: number; // ~0.3s attack / ~1s release
  slowEnvelope: number;
}

export interface AudioFeatures {
  frameTime: number; // seconds per feature frame
  frames: number;
  duration: number;
  data: Record<keyof Drive, Float32Array>;
  sample: (t: number) => Drive;
}

const FFT = 2048;
const HOP = 1024;

// In-place iterative radix-2 FFT.
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + half] * cr - im[i + k + half] * ci;
        const bi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + half] = ar - br;
        im[i + k + half] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function percentile(arr: Float32Array, p: number): number {
  const copy = Float32Array.from(arr);
  copy.sort();
  const idx = Math.min(copy.length - 1, Math.floor(p * copy.length));
  return copy[idx] || 1e-9;
}

function normalizeTo(arr: Float32Array, p: number) {
  const ref = percentile(arr, p) || 1e-9;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.min(1, Math.max(0, arr[i] / ref));
  }
}

// Perceptual band scaling: convert to dB, then map the track's own p20–p95
// dynamic range onto [0,1]. Linear magnitudes make quiet passages read as
// nothing; dB space is how loudness actually feels (and how TouchDesigner's
// analysis channels behave).
function dbNormalize(arr: Float32Array) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = 20 * Math.log10(arr[i] + 1e-6);
  }
  const lo = percentile(arr, 0.2);
  const hi = percentile(arr, 0.95);
  const range = Math.max(1e-3, hi - lo);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.min(1, Math.max(0, (arr[i] - lo) / range));
  }
}

// Adaptive onset detection: subtract a running median (~0.7 s window) from the
// rectified spectral flux, so a sustained rumble or busy mix doesn't raise the
// trigger baseline — only true transients poke above it.
function adaptiveOnset(arr: Float32Array, half = 15) {
  const src = Float32Array.from(arr);
  const buf: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(arr.length - 1, i + half);
    buf.length = 0;
    for (let j = a; j <= b; j++) buf.push(src[j]);
    buf.sort((x, y) => x - y);
    arr[i] = Math.max(0, src[i] - buf[buf.length >> 1]);
  }
  normalizeTo(arr, 0.95);
}

// Asymmetric one-pole envelope follower (in place).
function envelope(arr: Float32Array, attack: number, release: number) {
  let env = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    env += (x - env) * (x > env ? attack : release);
    arr[i] = env;
  }
}

export async function analyzeAudio(
  arrayBuffer: ArrayBuffer,
): Promise<AudioFeatures> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  try {
    if (ctx.state !== "closed") await ctx.close();
  } catch {
    /* context may already be closing */
  }

  const sr = buf.sampleRate;
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const N = L.length;
  const frames = Math.max(1, Math.floor((N - FFT) / HOP) + 1);

  // Hann window.
  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1));
  }

  const binHz = sr / FFT;
  const binOf = (f: number) =>
    Math.max(0, Math.min(FFT / 2, Math.round(f / binHz)));

  // Vocal log-normal weight peaking near 1 kHz, zero outside 120–6000 Hz.
  const w = new Float32Array(FFT / 2 + 1);
  for (let i = 0; i <= FFT / 2; i++) {
    const f = i * binHz;
    if (f < 120 || f > 6000) {
      w[i] = 0;
    } else {
      const ln = Math.log(f / 1000);
      w[i] = Math.exp((-ln * ln) / (2 * 0.75 * 0.75));
    }
  }

  // TouchDesigner-style band split.
  const lowLo = binOf(20);
  const lowHi = binOf(150);
  const midLo = binOf(150);
  const midHi = binOf(2000);
  const highLo = binOf(2000);
  const highHi = binOf(16000);
  // Trigger + vocal bands.
  const snareLo = binOf(300);
  const snareHi = binOf(3000);
  const vocLo = binOf(200);
  const vocHi = binOf(4000);
  const hpsLo = binOf(85);
  const hpsHi = binOf(1000);

  const out: Record<keyof Drive, Float32Array> = {
    low: new Float32Array(frames),
    mid: new Float32Array(frames),
    high: new Float32Array(frames),
    kick: new Float32Array(frames),
    snare: new Float32Array(frames),
    envelope: new Float32Array(frames),
    vocal: new Float32Array(frames),
    flux: new Float32Array(frames),
    slowVocal: new Float32Array(frames),
    slowEnvelope: new Float32Array(frames),
  };
  const harmonic = new Float32Array(frames);

  const midRe = new Float32Array(FFT);
  const midIm = new Float32Array(FFT);
  const sideRe = new Float32Array(FFT);
  const sideIm = new Float32Array(FFT);
  const midMag = new Float32Array(FFT / 2 + 1);
  const sideMag = new Float32Array(FFT / 2 + 1);
  const prevMid = new Float32Array(FFT / 2 + 1);

  const bandMean = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i <= b; i++) s += midMag[i];
    return s / Math.max(1, b - a + 1);
  };
  const bandFlux = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i <= b; i++) {
      const d = midMag[i] - prevMid[i];
      if (d > 0) s += d;
    }
    return s;
  };

  for (let fr = 0; fr < frames; fr++) {
    // Yield to the event loop periodically so a full-track analysis doesn't
    // freeze the UI (a 3-minute track is ~8k frames x 2 FFTs).
    if (fr > 0 && fr % 512 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const start = fr * HOP;
    let rms = 0;
    for (let i = 0; i < FFT; i++) {
      const l = L[start + i] || 0;
      const r = R[start + i] || 0;
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      rms += mid * mid;
      midRe[i] = mid * win[i];
      midIm[i] = 0;
      sideRe[i] = side * win[i];
      sideIm[i] = 0;
    }
    out.envelope[fr] = Math.sqrt(rms / FFT);

    fft(midRe, midIm);
    fft(sideRe, sideIm);
    for (let i = 0; i <= FFT / 2; i++) {
      midMag[i] = Math.hypot(midRe[i], midIm[i]);
      sideMag[i] = Math.hypot(sideRe[i], sideIm[i]);
    }

    out.low[fr] = bandMean(lowLo, lowHi);
    out.mid[fr] = bandMean(midLo, midHi);
    out.high[fr] = bandMean(highLo, highHi);

    // vocal = center-channel energy, log-normal weighted.
    let vocal = 0;
    for (let i = vocLo; i <= vocHi; i++) {
      vocal += Math.max(0, midMag[i] - 1.1 * sideMag[i]) * w[i];
    }
    out.vocal[fr] = vocal;

    // harmonic product spectrum salience.
    let hpsPeak = 0;
    let hpsSum = 0;
    let hpsCount = 0;
    for (let i = hpsLo; i <= hpsHi; i++) {
      const h = midMag[i] * midMag[2 * i] * midMag[3 * i];
      if (h > hpsPeak) hpsPeak = h;
      hpsSum += h;
      hpsCount++;
    }
    const mean = hpsSum / Math.max(1, hpsCount);
    harmonic[fr] = mean > 0 ? hpsPeak / mean : 0;

    // Rectified spectral flux per trigger band.
    out.kick[fr] = bandFlux(lowLo, lowHi);
    out.snare[fr] = bandFlux(snareLo, snareHi);
    let vflux = 0;
    for (let i = vocLo; i <= vocHi; i++) {
      const d = midMag[i] - prevMid[i];
      if (d > 0) vflux += d * w[i];
    }
    out.flux[fr] = vflux;

    prevMid.set(midMag);
  }

  // Harmonic gate: normalize by 90th pct, soft-knee, gate vocal.
  const hRef = percentile(harmonic, 0.9) || 1e-9;
  for (let i = 0; i < frames; i++) {
    const s = harmonic[i] / hRef;
    const knee = s / (s + 0.6);
    out.vocal[i] *= 0.3 + 0.7 * knee;
  }

  // Band levels + loudness: perceptual dB scaling against the track's own
  // dynamic range.
  dbNormalize(out.low);
  dbNormalize(out.mid);
  dbNormalize(out.high);
  dbNormalize(out.envelope);

  // Triggers: median-adaptive onset detection, then normalize.
  adaptiveOnset(out.kick);
  adaptiveOnset(out.snare);
  adaptiveOnset(out.flux);

  // Vocal: normalize to its 95th percentile, then a gentle perceptual lift so
  // mid-level phrases still drive the visual.
  normalizeTo(out.vocal, 0.95);
  for (let i = 0; i < frames; i++) {
    out.vocal[i] = Math.pow(out.vocal[i], 0.7);
  }

  // Slow copies BEFORE fast envelopes overwrite (from normalized curves).
  out.slowVocal = Float32Array.from(out.vocal);
  out.slowEnvelope = Float32Array.from(out.envelope);

  // Asymmetric envelope followers (coefs per ~23 ms hop).
  envelope(out.low, 0.55, 0.12);
  envelope(out.mid, 0.5, 0.1);
  envelope(out.high, 0.6, 0.15);
  envelope(out.kick, 0.8, 0.28); // punchy
  envelope(out.snare, 0.85, 0.3);
  envelope(out.envelope, 0.5, 0.08);
  envelope(out.vocal, 0.45, 0.06);
  envelope(out.flux, 0.7, 0.2);
  // Slow copies: ~0.3 s attack / ~1 s release — large-scale motion swells with
  // phrases instead of flickering with syllables.
  envelope(out.slowVocal, 0.08, 0.02);
  envelope(out.slowEnvelope, 0.08, 0.02);

  const frameTime = HOP / sr;
  const duration = buf.duration;

  const sample = (t: number): Drive => {
    const pos = t / frameTime;
    const i0 = Math.max(0, Math.min(frames - 1, Math.floor(pos)));
    const i1 = Math.min(frames - 1, i0 + 1);
    const f = pos - i0;
    const lerp = (a: Float32Array) => a[i0] + (a[i1] - a[i0]) * f;
    return {
      low: lerp(out.low),
      mid: lerp(out.mid),
      high: lerp(out.high),
      kick: lerp(out.kick),
      snare: lerp(out.snare),
      envelope: lerp(out.envelope),
      vocal: lerp(out.vocal),
      flux: lerp(out.flux),
      slowVocal: lerp(out.slowVocal),
      slowEnvelope: lerp(out.slowEnvelope),
    };
  };

  return { frameTime, frames, duration, data: out, sample };
}

export const IDLE_DRIVE: Drive = {
  low: 0,
  mid: 0,
  high: 0,
  kick: 0,
  snare: 0,
  envelope: 0,
  vocal: 0,
  flux: 0,
  slowVocal: 0,
  slowEnvelope: 0,
};
