import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeAudio,
  IDLE_DRIVE,
  type AudioFeatures,
  type Drive,
} from "../lib/audio-analysis";

/**
 * Playback + PRECOMPUTED audio analysis. The whole track is decoded and
 * feature-extracted up front (see audio-analysis.ts) — no live AnalyserNode —
 * so any consumer can sample the drive at an arbitrary time t. That global
 * view gives proper normalization and makes seek-based frame export possible.
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const featuresRef = useRef<AudioFeatures | null>(null);
  const analysisIdRef = useRef(0);

  const [trackName, setTrackName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasTrack, setHasTrack] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

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

  // The WebAudio graph is only needed to capture a MediaStream for video
  // recording; playback itself stays on the <audio> element.
  const ensureGraph = useCallback(() => {
    ensureEl();
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audioRef.current!);
      source.connect(ctx.destination);
      ctxRef.current = ctx;
      sourceRef.current = source;
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
    },
    [ensureEl],
  );

  const analyze = useCallback(async (arrayBuffer: ArrayBuffer) => {
    const id = ++analysisIdRef.current;
    featuresRef.current = null;
    setAnalyzing(true);
    try {
      const features = await analyzeAudio(arrayBuffer);
      if (analysisIdRef.current === id) featuresRef.current = features;
    } catch (err) {
      console.error("Audio analysis failed:", err);
    } finally {
      if (analysisIdRef.current === id) setAnalyzing(false);
    }
  }, []);

  const load = useCallback(
    async (file: File) => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(file);
      applySrc(objectUrlRef.current, file.name.replace(/\.[^./]+$/, ""));
      await analyze(await file.arrayBuffer());
    },
    [applySrc, analyze],
  );

  const loadUrl = useCallback(
    async (url: string, name: string) => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      try {
        const blob = await (await fetch(url)).blob();
        objectUrlRef.current = URL.createObjectURL(blob);
        applySrc(objectUrlRef.current, name);
        await analyze(await blob.arrayBuffer());
      } catch {
        applySrc(url, name);
      }
    },
    [applySrc, analyze],
  );

  const play = useCallback(async () => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "suspended") await ctx.resume();
    await ensureEl().play();
  }, [ensureEl]);

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

  // Sample the precomputed drive curves at time t (linear interpolation).
  const sampleDrive = useCallback((t: number): Drive => {
    return featuresRef.current?.sample(t) ?? IDLE_DRIVE;
  }, []);

  const getAudioStream = useCallback((): MediaStream | null => {
    ensureGraph();
    const ctx = ctxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source) return null;
    if (ctx.state === "suspended") void ctx.resume();
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
    analyzing,
  };
}
