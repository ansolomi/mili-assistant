# VTuber Assistant: Documentation

A local AI companion "Mili": 3D VRM avatar on a vertical 9:16 stage, voice chat, local LLM with vision, and one-click reel recording.
Everything here (docs, app code, models, settings, recordings, logs) lives in this folder. The "brain" is a fork of Open-LLM-VTuber in `../Open-LLM-VTuber`.

## Quick start

| Action | Command (PowerShell, from `vtuber-assistant/`) |
|---|---|
| Start everything; she appears on the desktop | `.\start-vtuber.ps1` |
| Open the 9:16 stage window instead | `.\start-vtuber.ps1 -StageWindow` |
| Start without opening a window | `.\start-vtuber.ps1 -NoWindow` |
| Stop everything (keeps Ollama) | `.\stop-vtuber.ps1` (`-Ollama` also stops Ollama) |
| Stage in any browser | http://localhost:8765/ (add `?clean=1` for a UI-free view for screen capture) |
| Brain (stock Live2D UI) | http://localhost:12393/ |

Auto-start at Windows logon: scheduled task `VTuberAssistant` runs `start-vtuber.ps1`. Remove with `Unregister-ScheduledTask VTuberAssistant`.

## Desktop overlay and file learning

- She walks along the bottom of your main monitor. Click her to type; right-click the pink tray icon for **Walk / stay put**, **Explore my files now**, **Quit**.
- She reads files in the folders listed in `data/knowledge/config.json` (default Desktop, Documents, D:\Projects), 10 per pass, hourly and on demand. Results: `data/knowledge/notes.json`, `digest.md`, `personality.md`. Delete those files to make her forget.
- Knowledge is loaded into her prompt when the brain connection starts; reconnect (restart the overlay) to pick up new notes.

- Behaviours: she walks, looks around, cheers, sits on the taskbar edge or on a window's top edge (when a non-maximised foreground window leaves room), and waves when the cursor lingers on her. Add more by dropping `.vrma` files into `data/animations/` and calling `stage.playClip(name)`.

## Using the stage

- **Type** in the box and press Enter, or **hold Space / the "Hold to talk" button** to speak (English; speech recognition is locked to `en`).
- **Record reel** captures the stage (1080x1920, 30 fps, subtitles included) plus her voice. The server saves `.webm` and converts to `.mp4` (H.264/AAC, Instagram-ready) in `data/recordings/`.
- **Stage settings** (top-left panel): model, background, hair and outfit colours, cat ears, hairpin, camera framing, subtitles, emotion tests. Press **Save settings** to persist them in `data/stage-settings.json`.
- The mic prompt appears the first time; the Edge app window keeps its own profile (`data/edge-profile`) so the permission sticks.

## Folder map

```
Documentation/
  README.md            this file
  DESIGN.md            original design, decisions, current state
  DEVLOG.md            what was built, problems hit, fixes
  app/overlay/         Electron shell for the desktop overlay (npm start)
  app/vrm-stage/       the 3D stage (three.js + @pixiv/three-vrm), built with Vite
    src/stage.js         scene, VRM loading, hair/outfit tint, cat ears, idle animation, lip sync, subtitles
    src/bridge.js        WebSocket client for the brain, audio playback, push-to-talk
    src/main.js          UI, settings panel, recording
    src/overlay.js       desktop overlay behaviour (walk, click-through, chat box)
    learn.js             file explorer that builds data/knowledge/*
    server.js            serves dist/, data/ and the settings/recording APIs
  data/
    models/              .vrm avatars (Seed-san, Twist-sample)
    backgrounds/         optional background images (png/jpg/webp)
    recordings/          saved reels
    stage-settings.json  saved stage settings
    edge-profile/        browser profile of the app window
  logs/                server and stage logs
```

## How it fits together

```
 Edge app window --(WebSocket /client-ws)--> Open-LLM-VTuber server :12393 --> Ollama qwen3-vl:8b-instruct (chat + vision)
   VRM stage :8765        text-input / mic audio        |-- SenseVoice ASR (English)
   lip sync from audio    <-- audio + emotion index     |-- Edge TTS ja-JP-NanamiNeural (Kokoro kept as local option)
```

- The stage speaks the same protocol as the stock web client, so all brain features (persona, memory, MCP tools) are unchanged.
- Emotions: the brain emits tags such as `[joy]`; `vrm_stage` in `Open-LLM-VTuber/model_dict.json` maps them to indices 0-7, and `EMOTION_BY_INDEX` in `stage.js` maps those to VRM expressions. Keep both lists in the same order.
- `conf.yaml` has `live2d_model_name: 'vrm_stage'`. Set it back to `'mao_pro'` to use the old Live2D avatar in the stock UI.

## Changing the avatar

0. Current default is **Taila** (converted from your GLB, see DEVLOG phase 5). Any rigged GLB with a Rigify-style skeleton can be converted with `tools/glb2vrm.mjs` after adapting its bone names; VRoid/VRM files need no conversion.

1. Put a `.vrm` file (VRM 0.x or 1.0) into `data/models/`. It appears in **Stage settings > model**.
2. For a look like the reference (silver hair, cat ears, dark outfit): make a model in **VRoid Studio** (free) with grey hair and an animal-ear accessory, export as VRM, and turn off the procedural ears (`ears` toggle). Models from VRoid Hub also work when their license allows it.
3. Hair/outfit tint works on materials named like `Hair*`, `Tops*`, `Bottoms*` (VRoid naming). Other naming needs a small change in `loadVRM` in `stage.js`.
4. Check each model's license. Bundled: Twist-sample (pixiv, VRM Public License 1.0) and Seed-san (VirtualCast, VRM Public License 1.0).

## Known limits

- The reference reel could not be opened (Instagram blocks automated access); the look is based on the supplied still image. Kyndred itself is an AI-character company; no code or assets from it are used.
- Poses are procedural (breathing, weight shift, random idle poses, nods, ear twitch). There are no mocap or Mixamo animations yet.
- Skirt, belt and braid are simple meshes fixed to the hips/head: they do not swing with physics.
- Lip sync is amplitude and spectral-centroid based, not phoneme accurate.
- Web search through tools is unreliable with this model (see DEVLOG).
- Edge TTS is an unofficial cloud endpoint and can break.
