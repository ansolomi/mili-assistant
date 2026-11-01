# Development log

## Phase 0: brain (Oct 2026)
- Forked Open-LLM-VTuber v1.2.1 (`../Open-LLM-VTuber`), Python via `uv`.
- LLM: Ollama `qwen3-vl:8b-instruct` (vision + tools), context 16384 via user env `OLLAMA_CONTEXT_LENGTH`. Claude API left configured but unused (needs a paid API key).
- ASR: SenseVoice via sherpa-onnx, `language: en` (added a `language` option in `sherpa_onnx_asr.py` and `config_manager/asr.py`).
- TTS: Edge `ja-JP-NanamiNeural`. Kokoro multilingual v1.0 (local, sherpa-onnx) works for English and Chinese only; Japanese came out as garbage. Kokoro patch is in `tts/sherpa_onnx_tts.py` (`kokoro_*` options).
- Persona "Mili" in `conf.yaml`. Replying in Japanese only worked once the rule was appended at the END of the system prompt (`prompts/final_instructions.txt`, appended in `service_context.py`); persona-only wording was ignored.
- Date/time is injected into the system prompt at connection (the MCP time tool was never called correctly by the model).
- Fixed `AssertionError` in websockets `_drain_helper` with large WAV payloads: `run_server.py` uses `ws="websockets-sansio"`.
- Auto-start: scheduled task `VTuberAssistant` at logon.

## Phase 1: 3D stage (Nov 2026)
- Goal: output similar to the Kyndred reel still: 3D VRM avatar, grey hair, cat ears, hairpin, dark outfit, blue vertical backdrop.
- Built `app/vrm-stage` with three.js + @pixiv/three-vrm 3.5.5 + Vite + lil-gui. No Mixamo; animation is procedural.
- First model Seed-san had mechanical arm accessories that cluttered the frame; switched default to pixiv's Twist-sample (VRoid style).
- Hair is retinted by desaturating the hair texture and multiplying a tint colour; outfit is a colour multiply; cat ears and hairpin are procedural meshes attached to the head bone.
- Stage speaks the stock `/client-ws` protocol. After each reply it must send `frontend-playback-complete` or the server waits.
- Recording: composite canvas (3D + subtitles) captureStream + audio tap -> MediaRecorder -> POST to `server.js` -> ffmpeg to MP4. Verified: 1080x1920 H.264 + AAC.
- Launcher now starts Ollama, brain, stage server, and an Edge app window (`--app`, own profile, autoplay flag).

## Phase 2: better avatar (Nov 2026)
- No free VRMA/CC0 animation pack or licence-friendly silver cat-girl VRM found, so everything stays procedural.
- Idle: weight shift between the legs, plus a pose scheduler (relaxed, hands behind back, hands in front, shrug) that blends arm poses every 5 to 11 s; `wave` fires sometimes on `joy`. Poses are `POSES` in `stage.js`; the settings panel has pose test buttons.
- Look: pleated skirt over the dress shorts (shorts tinted to skin colour), grey-blue belt with buckle, side braid beside the right ear. All adjustable under Stage settings (skirt, braid, colours, height, length).

## Phase 3: desktop overlay and file explorer (Nov 2026)
- `app/overlay` is an Electron shell (transparent, frameless, always on top, click-through except over her pixels) that loads the stage with `?overlay=1` at 360x640. She walks along the bottom of the primary monitor (`src/overlay.js`): random targets, 60 px/s, side-on walk cycle with arm and leg swing, stops while she talks or the chat box is open. Click her to type; tray icon menu: walk toggle, explore files now, quit. She looks at the real cursor (main process sends its position at 10 Hz).
- `learn.js` (inside the stage server) reads text files from the folders in `data/knowledge/config.json`, newest first, 10 per pass (first pass 60 s after start, then hourly, or on demand via the tray, the Test folder button, or POST /api/learn). The local model writes a summary and facts per file into `notes.json`, rebuilds `digest.md`, and rewrites `personality.md` (at most 8 bullets). While it runs she shows "Reading <file>..." above her head.
- The brain appends `digest.md` and `personality.md` to her system prompt at connection (`service_context.py`), so new knowledge shows up on the next reconnect.
- Privacy limits: only text/code extensions, files under 200 KB, skips credential-looking names (.env, token, key, password, ...) and her own folders. Edit `config.json` to change roots.
- Launcher: overlay is the default; `-StageWindow` opens the old 9:16 Edge window.
- VRoid: VRoid Studio is a GUI-only tool (winget `pixivInc.VRoidStudio`), so a new model cannot be built or exported from here. Drop any `.vrm` into `data/models/`.

## Phase 4: animation clips and desktop interaction (Nov 2026)
- Supplied `domeka.obj/.mtl` (a Zelda game rip) is a static mesh: 20k vertices in two parts (face, body), no skeleton, no textures, no hair or clothes. It cannot be animated or loaded as VRM without rigging and texturing by hand, so it was not used. VRoid Studio and Blender are not installed; there is no tool here to drive them.
- Animation format: VRMA, played with `@pixiv/three-vrm-animation` (`Stage.loadClips/playClip/stopClip`). Any VRMA works with any VRM. Clips live in `data/animations` (10 clips from Kiu-Q/hikari-archive, MIT). While a clip plays, the procedural idle/walk is paused; head, expressions and lip sync keep running.
- Overlay behaviours (`src/overlay.js`): walk, look around (`idle_look`), cheer (`wave_fast`), perch (reach up with `hang`, `sit_down`, `sit` loop 20 to 45 s, `sit_up`) on the taskbar edge or on the top edge of the foreground window (read by `overlay/fg.ps1`), greet the cursor with a procedural wave when it lingers on her. Verified by screenshot: she sat on a dialog's top edge.
- Limits: windows are tracked by size, not handle; needs window top at least 360 px from the screen top; single monitor, 100% DPI assumed; `lay` and `hanging` clips are unused (no good view from the front camera).

## Phase 5: Taila model (Nov 2026)
- `taila-original-work.zip` (user supplied) holds a textured Blender/Rigify GLB with 155 deform bones, 12 materials, no morph targets. Extracted to `data/source/taila/`.
- `app/vrm-stage/tools/glb2vrm.mjs` converts it to `data/models/Taila.vrm`: re-parents the flat DEF- bones into a humanoid hierarchy (world transforms kept), raises both arms 31.6 degrees to T-pose (rig was A-pose), adds VRMC_vrm humanoid, eye look-at and meta. Run: `node tools/glb2vrm.mjs <glb> <vrm>`.
- Taila is now the default model; `OWN_LOOK` in `main.js` turns off the procedural ears, skirt, braid, tints and sets a wider camera for it (restored when switching back).
- VRMA clips, walking and the overlay behaviours all work on it (checked by screenshot).
- Face animation by texture (`buildFace/updateFace` in `stage.js`): the Face material's emissive map is copied to a canvas; blinks and happy eyes hide the iris meshes and paint skin plus a lash line over the two sclera islands (texture edges, y 384), and lip sync paints a 4-level open mouth over the painted dash. Texture coordinates are Taila specific, and the glTF image arrives vertically flipped. Redraws only when the state changes.
- Limits: no other expressions (angry, sad, surprised) on Taila. Hair and skirt bones are static (no spring physics). The overlay `pos` IPC now clamps and try/catches `setPosition` (crashed with a conversion error once). Licence of the model is unknown: the VRM meta says personal use only; keep it local.

## Open issues / next ideas
- Tool calling (web search) misfires with this model: it writes `[tool(...)]` text instead of calling. Try a different model or a separate tool-agent step.
- Replace procedural ears/outfit with a purpose-made VRoid model matching the reference (needs a person in VRoid Studio).
- Overlay: dragging, other monitors, sitting on window title bars, reading PDFs/Word files, file notes are English-biased and sometimes about her own code.
- Idle animation library (Mixamo FBX retargeted to VRM) for richer body motion; hand gestures.
- Phoneme-based lip sync; blendshape tuning per model. For Taila: add a mouth/eyelid solution (texture swap or morph targets made in Blender), spring bones for hair and skirt.
- Screen vision: the Screen tab of the stock UI sends frames to the vision model; not yet exposed in the VRM stage.
- Background pack and per-scene presets for different reels.

## v1.0 (2026-11-01)

Packaged as a Windows exe and tested by driving the live desktop.

- Build: `npm run build` in app/vrm-stage, then `npm run pack` in app/overlay. Output: `Mili/Mili-win32-x64/Mili.exe` (unpacked, because fg.ps1 must be readable by PowerShell). The exe finds the project root by walking up to start-vtuber.ps1 and starts Ollama, the brain and the stage server itself when they are down (cold start about 40 s). Everything still runs on local servers (:11434, :12393, :8765).
- Tray menu: Walk / stay put, Explore my files now, Quit, Quit and stop all services. Desktop shortcut: Mili.lnk.
- Test pass (real mouse input, chat box, brain websocket, synthesized speech):
  - Hover hit-test and click open the chat box: pass (needs real relative mouse moves; absolute SetCursorPos moves never reach the window, which is a test-tool limit only).
  - Typed chat: pass. Date and time were answered correctly (the 8B model got the weekday wrong once, the prompt itself says Sunday).
  - Knowledge digest: pass, she described the user's projects from digest.md.
  - Voice: pass. SenseVoice transcribed a synthesized English sentence and she replied with a joke tagged [joy].
- Fixed during the pass: the chat box did not take keyboard focus (window focus is asynchronous), now focuses 150 ms later and calls webContents.focus().
- Known limits: the OS may keep another window in the foreground after the click, so typing can land in that window until it is clicked again (not reproduced with a real mouse). Weekday answers from the small model can be wrong. Perching needs a non-maximised window.

## v1.1 (2026-11-01)

Japanese voice switched from Edge TTS (Nanami) to the VOICEVOX engine.

- Engine 0.26.0 (Windows CPU, free) lives in Documentation/data/voicevox (not in git, about 2 GB unpacked). Download: `gh release download 0.26.0 --repo VOICEVOX/voicevox_engine --pattern "voicevox_engine-windows-cpu-0.26.0.7z.001"`, extract with 7-Zip into Documentation/data/voicevox. start-vtuber.ps1 starts it on :50021 when present; stop-vtuber.ps1 stops it.
- Brain: new `tts/voicevox_tts.py` (audio_query then synthesis, Japanese only), registered in tts_factory.py and config_manager/tts.py. conf.yaml: `tts_model: voicevox_tts`, speaker 20 (Mochiko-san normal), intonation 1.1. Other voices: GET /speakers (3 Zundamon, 8 Kasukabe Tsumugi). To go back, set `tts_model: edge_tts`.
- Check: text and voice chat both return VOICEVOX wav per sentence; the second sentence follows the first within about 0.7 s. I could not listen to the result, so whether it sounds more human is for the user to judge. Voice terms: credit the character (e.g. "VOICEVOX:もち子(cv 明日葉よもぎ)") if the voice is published.
- Repo layout: the brain is a clone of upstream, so our changes are kept as Open-LLM-VTuber.patch (against upstream 992309c) plus Open-LLM-VTuber-overrides/ (conf.yaml, prompts). Apply with `git apply` in a fresh upstream clone and copy the overrides over it.

## v1.2 (2026-11-01)

Overlay controls, a bigger box, voice input and a tray control panel.

- Drag: press and hold on her and move; release and she drops back to the taskbar. A plain click still opens the chat box. The main process moves the window from the cursor position (`drag` IPC), so it is smooth at any page zoom. Picking her up cancels a running behaviour (perch, walk) via the `aborted` check in overlay.js.
- Size: mouse wheel over her, the panel slider (50 to 160 %) or the tray Size menu. The window is resized and the page zoomed to match, feet and centre kept. The size is remembered (localStorage `mili.scale`).
- Bigger box: the window is now 520x800 (was 360x640) with the camera coverage scaled to match, so she looks the same size but arms, hair and clips are no longer cut off. Outside her pixels the window is still click-through.
- Voice: Ctrl+Alt+M (global hotkey) or the panel button starts listening; press again to send. It reuses the bridge's push-to-talk (16 kHz mono to SenseVoice). Tested: the hotkey toggles the mic and she answers what the mic picked up. A real spoken sentence was not tested this round (the earlier synthesized-speech test covers the ASR path).
- Control panel: left click the tray icon (hidden icons area) for a panel with Size, Talk, Walk, Hide/Show, Explore files and Quit. Right click keeps the menu. Files: app/overlay/panel.html, panel-preload.js; state flows renderer -> main via `report`.
- Fixed: the chat box close path had a comment swallowing `box.value = ''`.
- Checked: wheel resize (360x640 to 285x507, feet fixed), drag and drop to the floor, hotkey mic on and off, panel rendered in a standalone Electron window. Not checked: clicking the real tray icon (it sits in the hidden-icons flyout), dragging while perched, very large sizes near screen edges.

## v1.3: Claude Code bridge

- `vrm-stage/claude.js` runs `claude -p` headless (stream-json, full permissions, vault as working folder, parent folder added) and saves each job to the vault; `server.js` exposes `GET/POST /api/claude` and `POST /api/claude/cancel`.
- `overlay.js`: a typed `claude, <task>` or a spoken `hey claude, <task>` skips her LLM. Voice waits 4 s (Ctrl+Alt+C cancels). She reports finished jobs by feeding the `MILI:` line back to the brain.
- Overlay: Ctrl+Alt+C hotkey and a panel button showing running jobs.
- Untested end to end: the bundled Claude CLI was not signed in on this PC (`claude auth login` needed). The pipeline was checked up to the auth error.
- Fixes after first use: space in the overlay chat box started push-to-talk (global Space handler only skipped the old `#text` field); a mic button next to her toggles listening; rendering resolution follows window zoom and display scale (`Stage.setResolution`), so enlarged sizes stay sharp; head tracking is eased (and the stale window-local pointer handler no longer fights the 10 Hz cursor feed in the overlay); `/api/claude` returns 400 on bad JSON instead of crashing the server; `claude.js` also looks for the store-install copy of `claude.exe`; `claude-login.ps1` added. A real read-only job ran end to end (12 s).
- `Documentation/data/models/Taila-HD.vrm`: copy of Taila with all 7 colour textures upscaled 2x (Real-ESRGAN ncnn, `realesrgan-x4plus-anime` 4x then bicubic down to 2x, JPEG q95; 1024 to 2048, eyes 512 to 1024). The original `Taila.vrm` is untouched. The stage default picks the first `/taila/i` match, which is now the HD file; to go back, pick `Taila.vrm` in the stage menu and save settings, or remove the HD file.
