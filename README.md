# Neon Orbit VR

A gravity slingshot puzzle game built with IWSDK. Launch probes through gravitational fields, collect targets, chain combos, and master orbital mechanics — in VR or browser.

**Play now:** [https://ellyz2426.github.io/neon-orbit/](https://ellyz2426.github.io/neon-orbit/)

## Features

- **Orbital mechanics** — Real gravity simulation with dynamic gravity wells that orbit, oscillate, and pulse
- **8 game modes** — Classic, Slingshot, Time Trial, Precision, Chaos, Zen, Survival, Daily Challenge
- **48 achievements** — From first target to legendary milestones
- **XP & leveling** — Earn experience, unlock titles from Cadet to Ascended
- **Power-ups** — Shield, Magnet, Multi-Shot, Time Freeze
- **Wormhole portals** — Teleport probes across the field
- **5 visual themes** — Deep Space, Nebula, Solar, Ice, Void
- **Procedural audio** — Adaptive music that responds to gameplay intensity
- **Full persistence** — Stats, achievements, settings, and high scores saved locally
- **Level progression** — 50 levels per mode with star ratings and high score tracking

## Controls

### VR (Quest / any WebXR headset)
- **Right Trigger** — Charge and launch probe
- **Grip** — Toggle slow-motion
- **B / Y** — Pause
- **Left Thumbstick Click** — Camera follow toggle

### Browser
- **Space** — Charge and launch probe
- **Shift** — Toggle slow-motion
- **P / Esc** — Pause
- **F** — Camera follow probe

## Tech Stack

- [IWSDK](https://iwsdk.dev) (Immersive Web SDK) — WebXR/3D framework
- PanelUI — 16 spatial UI panels (uikitml → JSON, no HTML overlays)
- ECS architecture — 4 registered systems
- Procedural Web Audio — 14 synthesized sound effects + adaptive music
- Particle system — Additive blending with burst, ring, and directional effects

## Visual Effects

- Speed-based probe trail coloring (blue → red)
- Shield bubble wireframe around protected probes
- Probe glow light that intensifies with velocity
- Time-freeze visual tint effect
- Energy beams between nearby gravity wells
- Shooting stars with color-themed variation
- Nebula cloud backdrop spheres
- Ambient dust particles in the play field
- Score popup rings at collection points

## Building

```bash
npm install
npm run dev        # Dev server at https://127.0.0.1:8081/
npm run build      # Production build to dist/
```

Requires Node.js >= 20.19.0 and IWSDK 0.4.x.

## Architecture

- `src/index.ts` — ~2,080 lines of TypeScript
  - `OrbitPhysicsSystem` — Gravity simulation, collision, trail rendering, visual effects
  - `InputControlSystem` — XR controller + keyboard input, charge/launch, trajectory prediction
  - `GameUISystem` — 16 PanelUI panel queries with button wiring and real-time HUD updates
  - `StateWatcherSystem` — High score recording on level end
- `ui/*.uikitml` — 16 spatial UI panel templates
- `GameManager` — Game state, 48 achievements, XP, combo system, 8 modes
- `AudioManager` — Procedural Web Audio with 14 SFX + adaptive 4-layer drone music
- `GameSaveManager` — Full localStorage persistence for all game progress
- `HighScoreManager` — Per-mode per-level score/star/accuracy tracking

## License

Built with IWSDK by Kit (autonomous build pipeline).
