Decode the entire file with AudioContext.decodeAudioData. Do not use a live AnalyserNode — precomputing the whole track gives you global normalization and lets any consumer sample features at arbitrary time t, which is what makes seek-based frame export possible.
Framing: FFT size 2048, hop 1024, Hann window. At 44.1 kHz that's one feature frame per ~23 ms. Use a plain radix-2 iterative FFT on pre-allocated Float32Arrays.
Per frame, compute mid/side spectra: mid = (L+R)/2, side = (L−R)/2, FFT both, take magnitudes. Then extract:

level— time-domain RMS of mid.
bass— mean magnitude, 20–250 Hz.highs— 2–8 kHz.
vocal(the key signal) — over 200–4000 Hz:Σ max(0, |mid[i]| − 1.1·|side[i]|) · w(f). The mid−side subtraction removes wide-panned instruments (vocals are mixed center);w(f) = exp(−ln²(f/1000)/(2·0.75²)), zero outside 120–6000 Hz, is a log-normal emphasis peaking near 1 kHz. Mono input degrades gracefully (side = 0).
harmonic— harmonic product spectrum: over fundamental bins 85–1000 Hz,hps[i] = |mid[i]|·|mid[2i]|·|mid[3i]|; salience = peak/mean. Normalize by the 90th percentile, soft-knees/(s+0.6). Thengatethe vocal:vocal *= 0.3 + 0.7·harmonic. This is what stops a centered kick drum from reading as a voice — voices are sustained and pitched, kicks aren't.
flux— half-wave-rectified spectral difference in the vocal band, weighted byw(f)(vocal onsets/consonants).
beat— half-wave-rectified spectral difference in the 20–250 Hz band (kick onsets).
Post-processing: normalize each curve to its own 95th percentile, clamp to [0,1]. Then apply asymmetric one-pole envelope followers (env += (x−env)·coef, different coef for rise vs fall), per ~23 ms hop: vocal (attack 0.45, release 0.06), beat (0.8, 0.28 — punchy), flux (0.7, 0.2), level (0.5, 0.08), bass (0.55, 0.12). Additionally keep slow copies of vocal/level smoothed with (0.08, 0.02) — ≈0.3 s attack, ≈1 s release — these drive the large-scale motion so it swells with phrases instead of flickering with syllables. Sampling at arbitrary t is linear interpolation between frames.
2. Fire simulation (the generative core)
A "stable fluids"-family scalar solver on a 96×120 grid (portrait, matches the 640×800 output). The only state is the heat field; there is no velocity state — velocity is computed analytically each step, which is what keeps it cheap and deterministic.
Fixed timestep: H = 1/60 s, with an accumulator: advance(dt) consumes dt in H-sized substeps (cap 6 per call, shed backlog beyond that). The audio drive is sampled once per advance and held across its substeps.
Per substep, for every cell:

Velocity= buoyancy + curl noise:
vy = −(baseRise + 18·rise·heat[cell]) + curlY(negative = up; hotter cells rise faster),
baseRise = (5 + 13·rise)·(0.75 + 0.45·drive·reactivity)cells/s,
curl noise: take a scalar potentialφ = fbm(x·0.055, y·0.055 − scroll)wherescroll = t·baseRise·0.06, and setv_curl = (∂φ/∂y, −∂φ/∂x)·20·turbulencevia central differences (±0.06). Curl of a potential is divergence-free — that's what produces licking, swirling tongues instead of mushy diffusion. The fbm is 2-octave value noise over an integer hash (fully deterministic, no RNG state).

Semi-Lagrangian advection:backtrace(x − vx·H, y − vy·H), clamp to grid, bilinearly sample the previous heat field.
Cooling:multiply byexp(−(0.5 + 0.22·(1−drive))·H)— heat decays as it climbs; louder/vocal moments cool slower so plumes climb higher.
Emitters (bottom 3 rows, injected via max(amp, existing)):

Five independent Gaussian sources whose center (0.27–0.73, center-biased), width (0.06–0.13), and strength (0.35–1.0) each drift on their own slow value-noise track — this is what makes the base irregular and roaming rather than one symmetric mound.
The sum is scaled bybase = intensity·min(1.05, idle + reactivity·(0.5·bass + 0.55·drive)), whereidle = 0.14 + 0.1·breathandbreathis a sine with ~11 s period — the flame keeps breathing when the track is silent.
Multiply by a slow-noise ragged-edge factor0.62 + 0.46·noise(x·0.14, t·0.3)(never per-frame random dither — it strobes).
Beat flare:a narrow Gaussian (σ = 0.03) of amplitudereactivity·beat·0.8whose position jumps to a fresh noise-derived column every 0.5 s window.
Vocal core:a wide Gaussian (σ = 0.15) of amplitude(1 + 0.5·flux + 0.35·pulse)·base·0.42at a slowly wandering center — this is the white-hot column that climbs on vocal phrases (pulse= fast vocal envelope,drive= slow one).
Finish each substep with a separable 3-tap diffusion (amount 0.22) and clamp heat to [0, 1.8].
3. Rendering — the order of operations is the whole trick
Colorize after smoothing, never before. The one mistake that produces both pixelation and washed-out contrast is: colorize the low-res grid → upscale → blur. That bilinearly facets colored cells AND smears bright pixels into dark regions. Instead:

Write heat to a 96×120grayscalecanvas (grey = min(255, heat·140)).
Upscale + blur that grayscale to an intermediate240×300buffer (blur ≈2 + userBlur·0.3px, drawn with overscan so edges don't darken), thengetImageDatait back. All smoothing happens inheat space.
Apply the color rampper-pixel at 240×300. Piecewise over smoothed heath, through a 4-stop palette[background, deep, mid, core](e.g.#241820 → #8E1B0A → #FF2E0E → #FF8C2E): below 0.16 stay within 18% of the background (this preserves dynamic range — bled heat maps to adarkcolor); 0.16–0.46 deep→mid; 0.46–0.78 mid→core; above 0.78 blend core→white ×0.85 (white-hot only at true peaks). Use smoothstep on every segment'st. Multiply rgb by a vertical vignette0.66 + 0.34·(y/height)to keep the top deep.
Upscale to the 640×800 target with only alightfinal blur (1.5 + userBlur·0.1px) plussaturate(1.2+0.2·drive)andhue-rotate(userHue).
Overlay a static 128×128 hash-noise grain tile,overlaycomposite, alpha 0.05 (texture + kills banding in the big soft gradients).
Optional universal post-blur over the finished frame: round-trip through a scratch canvas whose padding ring is filled withclamp-to-edge pixels(stretch the border rows/columns/corners into the pad) — transparent padding measurably fades the frame edges under blur.
4. Determinism contract
Every function of the sim is pure given (state, drive, params) — noise is hash-based, no Math.random() in the step path (one per-instance wander seed aside). The exporter resets the field, then per frame at 30 fps: seek media to t, sample drive at t, advance(1/30), render, capture. Same audio in → byte-identical MP4 out (verified by hashing two consecutive exports). The live preview instead feeds wall-clock dt (clamped to 100 ms) with drive sampled at audio.currentTime — so the flame keeps evolving while paused and slider changes are visible immediately. Preview and export are not bit-identical to each other (irrelevant for a preview); export-to-export is.
5. Parameter surface
intensity (emitter heat), turbulence (curl amount), rise (buoyancy/updraft), breath (idle cycle rate), blur (internal heat softness), outputBlur (universal post-pass), reactivity (audio→motion gain), hueShift, vocalFocus (drive from vocal envelopes vs full-mix envelopes), palette preset, export length cap.