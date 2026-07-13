# Audio-Reactive Gradient Studio

## Context

The user wants an app that accepts an MP3, analyzes the audio in real time, drives a
reactive animated gradient from that analysis, and lets the user export the result.
A Figma design was imported (`src/imports/AudioReactivePrototype/`) showing a mobile
portrait audio player: a full-bleed gradient display area, a track title
("NORWEGIAN WOOD / Rubber Soul"), a progress bar, and PLAY / SAVE VIDEO controls.

Decisions confirmed with the user:
- **Export:** both video (WebM) and still image (PNG).
- **Framing:** keep the mobile portrait player look (fixed ~390px-wide frame),
  centered on screen against a black background, matching the Figma exactly.

The project is React + Tailwind v4 + Radix/shadcn UI (no `@make-kits` design system
installed). Entry point is `src/app/App.tsx`.

## Approach

Build the app around the imported design. `imports/` is read-only — all adaptation
happens in new components under `src/app/components/`. The visual chrome (frame,
title, progress bar, buttons, glow) mirrors the import; the gradient display area
becomes a live `<canvas>`, and interactivity + file upload + export are layered on top.

### Audio analysis — `src/app/hooks/useAudioAnalyser.ts`
- Web Audio API: `AudioContext`, `<audio>` element as `MediaElementAudioSourceNode`,
  connected to an `AnalyserNode` (fftSize ~1024) and to `destination` (so it plays).
- Expose: `load(file)`, `play()`, `pause()`, `isPlaying`, `currentTime`, `duration`,
  `trackName` (from the uploaded file name), and a `getBands()` reader returning
  smoothed **bass / mid / treble** energy + overall amplitude from
  `getByteFrequencyData`.
- Handle `AudioContext` resume on first user gesture (autoplay policy).
- Clean up nodes/URL object on unmount and on new file load.

### Gradient renderer — `src/app/components/GradientCanvas.tsx`
- A `<canvas>` sized to the display area, filling the player frame.
- `requestAnimationFrame` loop reads `getBands()` each frame and paints an animated
  multi-stop gradient (radial bloom + shifting linear base). Raw HTML canvas API
  (per env guidance — no konva).
- Reactive mapping: bass → bloom radius/scale, mid → hue rotation/color-stop drift,
  treble → brightness/highlight sparkle, amplitude → overall intensity.
- Colors driven by a small palette-token set defined once (avoid scattering hex);
  the import's dark plum aesthetic (`#242424`, black bg, warm plum tint from the
  screenshot) is the starting palette.
- Expose a ref/handle so the parent can grab the canvas for export.
- When paused/no audio, render a gentle idle animation so the area isn't dead.

### Player UI — `src/app/components/GradientPlayer.tsx`
- Faithfully re-render the imported structure from
  `src/imports/AudioReactivePrototype/index.tsx`: the portrait frame, the blurred
  ellipse glow (keep the SVG filter), the title/subtitle block, the progress track
  (two stacked bars — filled + rail), and the PLAY / SAVE buttons that use
  `svgPaths` from `src/imports/AudioReactivePrototype/svg-z2sp8uptcp.ts` (import the
  path data as the import does — do not redraw).
- Replace the `image 421132` slide area with `<GradientCanvas>`.
- Swap the hardcoded "Norwegian Wood / Rubber Soul" for the uploaded track name
  (fallback to placeholder before upload).
- Wire PLAY to toggle play/pause (label + icon reflect state); progress bar reflects
  `currentTime/duration` and supports click-to-seek.
- Add an MP3 dropzone / file picker (shown when no file loaded, plus a small
  "change track" affordance after). Accept `audio/mpeg`.
- Fonts: the import references `OPTIVenus:Bold` and `News Gothic Std:Medium`. These
  are user-catalog fonts flagged as pre-resolved; attempt to resolve via the font
  tooling during implementation. If unavailable, fall back to a close system stack
  and note it — do not silently guess a wildly different face.

### Export — `src/app/components/ExportControls.tsx` (or folded into player)
- **Image (PNG):** `canvas.toDataURL('image/png')` → trigger download. Instant snapshot.
- **Video (WebM):** `canvas.captureStream(30)` + optionally mix the audio track via
  `MediaStreamAudioDestinationNode`, record with `MediaRecorder` while playback runs,
  then download the resulting `.webm`. Show recording state; stop on pause/track end.
- Turn the single "SAVE VIDEO" button into export actions (e.g. a small menu or two
  buttons: Save Video / Save Image) using existing shadcn `dropdown-menu` or `button`
  components from `src/app/components/ui/`.
- Use `sonner` `toast` for export success/errors.

### Wiring — `src/app/App.tsx`
- Render `<GradientPlayer>` centered on a black background in a fixed ~390px-wide
  portrait frame (matches Figma). Own the audio hook here (or via context) and pass
  state down.

## Critical files
- `src/app/App.tsx` — compose and center the player (edit existing).
- `src/app/hooks/useAudioAnalyser.ts` — new; Web Audio analysis.
- `src/app/components/GradientCanvas.tsx` — new; reactive canvas renderer.
- `src/app/components/GradientPlayer.tsx` — new; renders the imported UI + controls.
- `src/app/components/ExportControls.tsx` — new; PNG + WebM export.
- Read-only refs: `src/imports/AudioReactivePrototype/index.tsx`,
  `src/imports/AudioReactivePrototype/svg-z2sp8uptcp.ts`.
- Reuse: `src/app/components/ui/*` (button, dropdown-menu), `sonner` for toasts.

## Verification
1. App loads showing the centered portrait player with an idle gradient + upload prompt.
2. Upload an MP3 → track name appears; PLAY starts playback and the gradient visibly
   reacts to the music (bass bloom, hue shifts on mids/treble).
3. Progress bar advances and seeking works; PLAY toggles to pause.
4. "Save Image" downloads a PNG snapshot of the current gradient frame.
5. "Save Video" records during playback and downloads a playable WebM.
6. Confirm no console errors, AudioContext resumes on first click, and the layout
   holds from mobile width up to desktop.
