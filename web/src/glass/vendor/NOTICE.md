# liquid-glass-webgl

Source: https://github.com/martin65536/liquid-glass-webgl
Revision: b4e0a6910443cea7cdd4b1bfcf7b2394e0a15e48
License: Apache-2.0 (see LICENSE).

sdf.ts is preserved from src/components/liquid-glass/shaders/sdf.ts.
../shader.ts adapts the circleMap lens refraction and distance-field gradient
from shaders/element.ts and shaders/element-utils.ts to a DOM-backed renderer.
Remoter changes: shared offscreen rendering, procedural backdrop, bounded DPR,
three-channel dispersion, event-driven rendering, CSS fallback. The upstream
Next.js demo, database and canvas-based UI are not bundled.

- continuous-curve.ts and continuous-mask.ts are adapted from upstream renderer sources.
