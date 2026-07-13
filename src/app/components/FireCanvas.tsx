import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Drive } from "../lib/audio-analysis";
import {
  DEFAULT_PARAMS,
  FireSim,
  type FireParams,
} from "../lib/fire-sim";
import { FireRenderer, type PalettePreset } from "../lib/fire-render";

export interface FireCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

interface FireCanvasProps {
  getTime: () => number;
  sampleDrive: (t: number) => Drive;
  params?: Partial<FireParams>;
  hueShift?: number;
  blur?: number;
  outputBlur?: number;
  palette?: PalettePreset;
  grey?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Live preview: wall-clock dt (clamped to 100ms) so the flame keeps evolving
 * while paused; drive sampled at the audio element's current time.
 */
export const FireCanvas = forwardRef<FireCanvasHandle, FireCanvasProps>(
  function FireCanvas(
    { getTime, sampleDrive, params, hueShift = 0, blur = 0, outputBlur = 0, palette = "inferno", grey = false, className, style },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const simRef = useRef<FireSim | null>(null);
    const rendererRef = useRef<FireRenderer | null>(null);
    const rafRef = useRef(0);

    // Keep latest props accessible inside the animation loop without restarting it.
    const propsRef = useRef({
      getTime,
      sampleDrive,
      params,
      hueShift,
      blur,
      outputBlur,
      palette,
      grey,
    });
    propsRef.current = {
      getTime,
      sampleDrive,
      params,
      hueShift,
      blur,
      outputBlur,
      palette,
      grey,
    };

    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      simRef.current = new FireSim();
      rendererRef.current = new FireRenderer();

      let last = performance.now();
      const loop = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const cur = propsRef.current;
        const t = cur.getTime();
        const drive = cur.sampleDrive(t);
        const p: FireParams = { ...DEFAULT_PARAMS, ...cur.params };

        simRef.current!.advance(dt, drive, p);
        const driveScalar =
          p.vocalFocus * drive.slowVocal +
          (1 - p.vocalFocus) * drive.slowLevel;
        rendererRef.current!.render(simRef.current!.heat, canvas, {
          blur: cur.blur,
          outputBlur: cur.outputBlur,
          hueShift: cur.hueShift,
          drive: driveScalar,
          palette: cur.palette,
          grey: cur.grey,
        });

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return <canvas ref={canvasRef} className={className} style={style} />;
  },
);
