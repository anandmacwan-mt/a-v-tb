import { GradientPlayer } from "./components/GradientPlayer";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black p-4">
      {/* Ambient background glow (mirrors the imported design's blurred ellipse) */}
      <div className="pointer-events-none absolute left-1/2 top-[70%] h-[220px] w-[420px] -translate-x-1/2 rounded-full bg-white opacity-10 blur-[120px]" />

      <GradientPlayer />

      <Toaster theme="dark" position="top-center" />
    </div>
  );
}
