import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_DRIVE, type Drive } from "../lib/audio-analysis";

/**
 * Handles playback and REAL-TIME audio analysis via an AnalyserNode. Live
 * analysis reacts immediately and avoids the main-thread freeze of decoding /
 * FFT-ing the whole file up front.
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Live-analysis scratch buffers + running state.
  const freqRef = useRef<Uint8Array | null>(null);
  const timeRef = useRef<Uint8Array | null>(null);
  const prevSpecRef = useRef<Float32Array | null>(null);
  const weightRef = useRef<Float32Array | null>(null);
  const slowRef = useRef({ vocal: 0, level: 0 });

  const [trackName, setTrackName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasTrack, setHasTrack] = useState(false);

  const ensureEl = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.addEventListener("timeupdate", () =>
        setCurrentTime(el.currentTime || 0),
      );
      el.addEventListener("loadedmetadata", () =>
        setDuration(Number.isFinite(el.duration) ? el.duration : 0),
      );
      el.addEventListener("ended", () => setIsPlaying(false));
      el.addEventListener("play", () => setIsPlaying(true));
      el.addEventListener("pause", () => setIsPlaying(false));
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const ensureGraph = useCallback(() => {
    ensureEl();
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audioRef.current!);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      source.connect(ctx.destination);

      const bins = analyser.frequencyBinCount;
      freqRef.current = new Uint8Array(bins);
      timeRef.current = new Uint8Array(analyser.fftSize);
      prevSpecRef.current = new Float32Array(bins);

      // Vocal log-normal weight peaking near 1 kHz (120–6000 Hz).
      const binHz = ctx.sampleRate / analyser.fftSize;
      const w = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        const f = i * binHz;
        if (f < 120 || f > 6000) w[i] = 0;
        else {
          const ln = Math.log(f / 1000);
          w[i] = Math.exp((-ln * ln) / (2 * 0.75 * 0.75));
        }
      }
      weightRef.current = w;

      ctxRef.current = ctx;
      sourceRef.current = source;
      analyserRef.current = analyser;
    }
  }, [ensureEl]);

  const applySrc = useCallback(
    (src: string, name: string) => {
      const el = ensureEl();
      el.src = src;
      el.load();
      setTrackName(name);
      setHasTrack(true);
      setIsPlaying(false);
      setCurrentTime(0);
      slowRef.current = { vocal: 0, level: 0 };
    },
    [ensureEl],
  );

  const load = useCallback(
    async (file: File) => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(file);
      applySrc(objectUrlRef.current, file.name.replace(/\.[^./]+$/, ""));
    },
    [applySrc],
  );

  const loadUrl = useCallback(
    async (url: string, name: string) => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      // Fetch into a same-origin blob URL so the AnalyserNode isn't CORS-tainted
      // (a cross-origin media source makes getByteFrequencyData return all zeros).
      try {
        const blob = await (await fetch(url)).blob();
        objectUrlRef.current = URL.createObjectURL(blob);
        applySrc(objectUrlRef.current, name);
      } catch {
        applySrc(url, name);
      }
    },
    [applySrc],
  );

  const play = useCallback(async () => {
    ensureGraph();
    const ctx = ctxRef.current!;
    if (ctx.state === "suspended") await ctx.resume();
    await audioRef.current?.play();
  }, [ensureGraph]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else void play();
  }, [isPlaying, pause, play]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  // Real-time drive. Called once per animation frame.
  const sampleDrive = useCallback((): Drive => {
    const an = analyserRef.current;
    const freq = freqRef.current;
    const time = timeRef.current;
    const prev = prevSpecRef.current;
    const w = weightRef.current;
    const ctx = ctxRef.current;
    if (!an || !freq || !time || !prev || !w || !ctx) return IDLE_DRIVE;

    an.getByteFrequencyData(freq);
    an.getByteTimeDomainData(time);
    const bins = freq.length;
    const binHz = ctx.sampleRate / an.fftSize;
    const binOf = (f: number) =>
      Math.max(0, Math.min(bins - 1, Math.round(f / binHz)));

    const bandMean = (lo: number, hi: number) => {
      const a = binOf(lo);
      const b = binOf(hi);
      let s = 0;
      for (let i = a; i <= b; i++) s += freq[i];
      return s / (Math.max(1, b - a + 1) * 255);
    };

    // Time-domain RMS.
    let rms = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      rms += v * v;
    }
    const level = Math.sqrt(rms / time.length);

    const bass = bandMean(20, 250);
    const highs = bandMean(2000, 8000);

    // Vocal: weighted energy in 200–4000 Hz band.
    const vLo = binOf(200);
    const vHi = binOf(4000);
    let vocal = 0;
    let vw = 0;
    for (let i = vLo; i <= vHi; i++) {
      vocal += (freq[i] / 255) * w[i];
      vw += w[i];
    }
    vocal = vw > 0 ? vocal / vw : 0;

    // Flux (vocal band) & beat (bass band) = half-wave-rectified spectral flux.
    let flux = 0;
    for (let i = vLo; i <= vHi; i++) {
      const cur = freq[i] / 255;
      const d = cur - prev[i];
      if (d > 0) flux += d * w[i];
    }
    flux = vw > 0 ? flux / vw : 0;

    const bLo = binOf(20);
    const bHi = binOf(250);
    let beat = 0;
    for (let i = bLo; i <= bHi; i++) {
      const cur = freq[i] / 255;
      const d = cur - prev[i];
      if (d > 0) beat += d;
    }
    beat /= Math.max(1, bHi - bLo + 1);

    for (let i = 0; i < bins; i++) prev[i] = freq[i] / 255;

    // Gain + clamp so the flame gets a strong, responsive signal.
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const g = {
      level: clamp(level * 3.2),
      bass: clamp(bass * 2.2),
      highs: clamp(highs * 2.6),
      vocal: clamp(vocal * 2.6),
      beat: clamp(beat * 9),
      flux: clamp(flux * 9),
    };

    // Slow envelopes for large-scale motion.
    const slow = slowRef.current;
    slow.vocal += (g.vocal - slow.vocal) * 0.12;
    slow.level += (g.level - slow.level) * 0.12;

    return {
      level: g.level,
      bass: g.bass,
      highs: g.highs,
      vocal: g.vocal,
      beat: g.beat,
      flux: g.flux,
      slowVocal: slow.vocal,
      slowLevel: slow.level,
    };
  }, []);

  const getAudioStream = useCallback((): MediaStream | null => {
    ensureGraph();
    const ctx = ctxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source) return null;
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest);
    return dest.stream;
  }, [ensureGraph]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "closed") {
        ctx.close().catch(() => {
          /* context may already be closing */
        });
      }
      ctxRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
    };
  }, []);

  return {
    load,
    loadUrl,
    toggle,
    seek,
    getTime,
    sampleDrive,
    getAudioStream,
    trackName,
    isPlaying,
    currentTime,
    duration,
    hasTrack,
    analyzing: false as boolean,
  };
}
