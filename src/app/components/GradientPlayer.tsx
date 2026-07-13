import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Pause,
  Play,
  Settings2,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import svgPaths from "../../imports/AudioReactivePrototype/svg-z2sp8uptcp";
import defaultTrackUrl from "../../imports/Nowhere_Man__Remastered_2009_.mp3";
import { useAudioEngine } from "../hooks/useAudioEngine";
import { FireCanvas, type FireCanvasHandle } from "./FireCanvas";
import type { FireParams } from "../lib/fire-sim";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";

const ARTIST = "The Beatles";

function formatTime(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Controls extends FireParams {
  hueShift: number;
  blur: number;
  outputBlur: number;
}

const DEFAULT_CONTROLS: Controls = {
  intensity: 1,
  turbulence: 1,
  rise: 0.6,
  breath: 1,
  reactivity: 1,
  vocalFocus: 0.7,
  hueShift: 0,
  blur: 0,
  outputBlur: 0,
};

export function GradientPlayer() {
  const audio = useAudioEngine();
  const fireRef = useRef<FireCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [ctrl, setCtrl] = useState<Controls>(DEFAULT_CONTROLS);
  const [greyMode, setGreyMode] = useState(false);

  const {
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
  } = audio;

  const progress = duration > 0 ? currentTime / duration : 0;

  // Load the bundled Norwegian Wood track by default.
  const loadedDefault = useRef(false);
  useEffect(() => {
    if (loadedDefault.current) return;
    loadedDefault.current = true;
    void loadUrl(defaultTrackUrl, "Nowhere Man");
  }, [loadUrl]);

  const fireParams = useMemo<FireParams>(
    () => ({
      intensity: ctrl.intensity,
      turbulence: ctrl.turbulence,
      rise: ctrl.rise,
      breath: ctrl.breath,
      reactivity: ctrl.reactivity,
      vocalFocus: ctrl.vocalFocus,
    }),
    [ctrl],
  );

  const onFile = useCallback(
    (file?: File | null) => {
      if (!file) return;
      if (!file.type.includes("audio") && !/\.mp3$/i.test(file.name)) {
        toast.error("Please choose an MP3 audio file.");
        return;
      }
      void load(file);
      toast.success(`Loaded "${file.name.replace(/\.[^./]+$/, "")}"`);
    },
    [load],
  );

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      seek(Math.max(0, Math.min(1, ratio)) * duration);
    },
    [duration, seek],
  );

  const saveImage = useCallback(() => {
    const canvas = fireRef.current?.getCanvas();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${trackName || "the-beatles"}-fire.png`;
    a.click();
    toast.success("Saved image (PNG)");
  }, [trackName]);

  const saveVideo = useCallback(() => {
    const canvas = fireRef.current?.getCanvas();
    if (!canvas) return;
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    if (!hasTrack) {
      toast.error("Load a track first to record a video.");
      return;
    }

    const stream = canvas.captureStream(30);
    const audioStream = getAudioStream();
    if (audioStream) {
      audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    } catch {
      toast.error("Video recording isn't supported in this browser.");
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${trackName || "the-beatles"}-fire.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
      toast.success("Saved video (WebM)");
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    if (!isPlaying) toggle();
    toast("Recording… press again to stop.");
  }, [isRecording, hasTrack, getAudioStream, trackName, isPlaying, toggle]);

  const setParam = (key: keyof Controls, value: number) =>
    setCtrl((c) => ({ ...c, [key]: value }));

  return (
    <div className="relative flex h-[780px] max-h-[92vh] w-[390px] max-w-full flex-col overflow-hidden rounded-[12px] bg-black">
      {/* Fire display area */}
      <div className="group relative m-[16px] mb-0 flex-1 overflow-hidden rounded-[8px] bg-black">
        <FireCanvas
          ref={fireRef}
          getTime={getTime}
          sampleDrive={sampleDrive}
          params={fireParams}
          hueShift={ctrl.hueShift}
          blur={ctrl.blur}
          outputBlur={ctrl.outputBlur}
          grey={greyMode}
          className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 object-cover"
          // 50px blur; scale up so the blurred edges stay filled inside the frame.
          style={{ filter: "blur(50px)", transform: "translate(-50%,-50%) scale(1.4)" }}
        />

        {!hasTrack && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-white transition-colors hover:bg-black/35"
          >
            <span className="flex size-14 items-center justify-center rounded-full border border-white/40">
              <Upload className="size-6" />
            </span>
            <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[13px] uppercase tracking-wide">
              Drop or choose an MP3
            </span>
          </button>
        )}

        {analyzing && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <span className="rounded-full bg-black/60 px-3 py-1 font-['News_Gothic_Std:Medium',sans-serif] text-[11px] uppercase text-white">
              Analyzing audio…
            </span>
          </div>
        )}

        {isRecording && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white">
            <span className="size-2 animate-pulse rounded-full bg-white" />
            <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[11px] uppercase">
              Recording
            </span>
          </div>
        )}

        {/* Settings */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="absolute right-3 top-3 flex h-[37px] items-center gap-2 rounded-[8px] border border-white/20 bg-black/40 px-3 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 hover:bg-white/10 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="Simulation settings"
            >
              <Settings2 className="size-3.5" />
              <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[12px] uppercase">
                Adjust
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 border-white/15 bg-black text-white"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[12px] uppercase text-white">
                  Grey Mode
                </span>
                <Switch checked={greyMode} onCheckedChange={setGreyMode} />
              </div>
              {(
                [
                  ["intensity", "Intensity", 0, 2],
                  ["turbulence", "Turbulence", 0, 2],
                  ["rise", "Rise", 0, 1],
                  ["reactivity", "Reactivity", 0, 2],
                  ["vocalFocus", "Vocal Focus", 0, 1],
                  ["breath", "Breath Rate", 0.2, 3],
                  ["blur", "Softness", 0, 4],
                  ["hueShift", "Hue Shift", 0, 360],
                ] as [keyof Controls, string, number, number][]
              ).map(([key, label, min, max]) => (
                <div key={key}>
                  <div className="mb-1 flex justify-between font-['News_Gothic_Std:Medium',sans-serif] text-[11px] text-white/70">
                    <span>{label}</span>
                    <span>{ctrl[key].toFixed(key === "hueShift" ? 0 : 2)}</span>
                  </div>
                  <Slider
                    value={[ctrl[key]]}
                    min={min}
                    max={max}
                    step={key === "hueShift" ? 1 : 0.05}
                    onValueChange={(v) => setParam(key, v[0])}
                  />
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Track meta — artist is always The Beatles */}
      <div className="px-6 pt-6 text-center">
        <p className="font-['OPTIVenus:Bold',sans-serif] text-[18px] uppercase text-white">
          {trackName || "No Track Loaded"}
        </p>
        <p className="mt-1 font-['News_Gothic_Std:Medium',sans-serif] text-[12px] text-white/70">
          {ARTIST}
        </p>
      </div>

      {/* Progress */}
      <div className="px-6 pt-5">
        <div
          className="relative h-[6px] w-full cursor-pointer rounded-[8px] bg-white/15"
          onClick={handleSeek}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-[8px] bg-white"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-['News_Gothic_Std:Medium',sans-serif] text-[11px] text-white/60">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-6 pb-6 pt-3">
        <button
          type="button"
          onClick={() => (hasTrack ? toggle() : fileInputRef.current?.click())}
          className="flex h-[37px] items-center gap-2 rounded-[8px] border border-white/20 px-4 text-white transition-colors hover:bg-white/10"
        >
          {isPlaying ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
          <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[12px] uppercase">
            {isPlaying ? "Pause" : "Play"}
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-[37px] items-center gap-2 rounded-[8px] border border-white/20 px-4 text-white transition-colors hover:bg-white/10"
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 14 14">
                <path
                  d="M7 9.91667V1.75"
                  stroke="white"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={svgPaths.pa874a00}
                  stroke="white"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M11.0833 12.25H2.91667"
                  stroke="white"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-['News_Gothic_Std:Medium',sans-serif] text-[12px] uppercase">
                {isRecording ? "Stop" : "Export"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={saveImage}>
              <ImageIcon className="mr-2 size-4" /> Save Image (PNG)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={saveVideo}>
              {isRecording ? (
                <>
                  <Square className="mr-2 size-4" /> Stop &amp; Save Video
                </>
              ) : (
                <>
                  <Video className="mr-2 size-4" /> Record Video (WebM)
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 size-4" /> Change Track
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,.mp3"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
