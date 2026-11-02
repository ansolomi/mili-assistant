# Mili: a desktop VTuber companion

Mili is a local AI companion who lives on your Windows desktop. She is a 3D (VRM) character in a transparent, click-through window that walks along the taskbar, sits on window edges, reacts to your cursor, reads your files to learn about you, and talks with you by text or voice. Everything runs on your own machine: no API key, no subscription.

```
Mili.exe (Electron overlay)  <->  VRM stage (Node :8765, three.js)  <->  Brain (Open-LLM-VTuber, Python :12393)
                                                                          |-- LLM: Ollama qwen3-vl:8b-instruct (:11434)
                                                                          |-- Speech recognition: SenseVoice (sherpa-onnx)
                                                                          '-- Voice: VOICEVOX engine (:50021), Japanese
```

She answers in Japanese (the voice is Japanese only); you can talk or type to her in English.

## What you need

| | |
|---|---|
| OS | Windows 10 or 11, 64-bit |
| Disk | about 25 GB free (LLM 6 GB, VOICEVOX 2 GB unpacked, Python packages, models) |
| Memory | 16 GB RAM recommended. A GPU is not required; replies are faster with one |
| Internet | for the one-time downloads |
| Accounts | none. All downloads are free |

The setup script installs the tools it needs with `winget` (git, Node.js LTS, uv, Ollama, 7-Zip) if they are missing.

## Install

1. Open PowerShell and clone this repository (it is private, so sign in with `gh auth login` or a token first):

   ```powershell
   git clone https://github.com/ansolomi/mili-vtuber.git
   cd mili-vtuber
   ```

2. Run the setup script. It takes 20 to 60 minutes, mostly downloads:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```

   What it does, in order:
   1. installs missing tools through winget (git, Node.js, uv, Ollama, 7-Zip);
   2. clones the Open-LLM-VTuber brain at the exact upstream commit this project was built on, applies `Open-LLM-VTuber.patch` and copies `Open-LLM-VTuber-overrides/` (our `conf.yaml` and prompt) over it;
   3. `uv sync` for the brain's Python environment;
   4. sets `OLLAMA_CONTEXT_LENGTH=16384` and pulls the `qwen3-vl:8b-instruct` model;
   5. downloads the VOICEVOX engine 0.26.0 (CPU) into `Documentation/data/voicevox`;
   6. `npm install` and build for the stage and the overlay;
   7. packs `Mili\Mili-win32-x64\Mili.exe` and puts a **Mili** shortcut on your desktop.

   Options: `-SkipModels` (no Ollama download), `-SkipVoice` (no VOICEVOX; switch `tts_model` to `edge_tts` in `Open-LLM-VTuber\conf.yaml`), `-NoExe` (use Electron directly). It is safe to run again; finished steps are skipped.

3. Start her: double-click the **Mili** shortcut, or run `powershell -ExecutionPolicy Bypass -File .\start-vtuber.ps1`. The first start downloads the speech model (about 230 MB) and loads everything, so give it a few minutes. After that a cold start takes about 40 seconds. Mili.exe starts any service that is not running yet.

If a step fails, fix the cause (the message says which) and run `setup.ps1` again. Manual equivalents of each step are in [Documentation/README.md](Documentation/README.md) and [Documentation/DEVLOG.md](Documentation/DEVLOG.md).

## Using her

| Do this | Result |
|---|---|
| Click the small mic next to her | starts and stops listening, same as Ctrl+Alt+M |
| Click her | opens a chat box; type and press Enter (Esc closes it) |
| Press and hold on her, then move | picks her up and carries her; she drops back to the taskbar when you let go |
| Scroll the wheel over her | makes her bigger or smaller (50 to 160 %, remembered) |
| **Ctrl+Alt+M** | starts listening; press again to send what you said |
| Click the pink tray icon (hidden icons area) | control panel: size, talk, walk on/off, hide/show, explore files, quit |
| Right-click the tray icon | the same actions as a menu |
| Type `claude, <task>` in her chat box | starts a headless Claude Code job (see below) |
| Say "hey claude, <task>" or "クロード、<task>" | same, after a 4 s delay; **Ctrl+Alt+C** cancels |
| Leave the cursor on her | she waves |

Her behaviours (walking, looking around, cheering, sitting on the taskbar or on a window's top edge) happen on their own. Only the pixels of her body take mouse clicks; the rest of her window is click-through.

### Claude Code jobs

Mili can hand work to Claude Code and tell you the result in Japanese. Jobs run `claude -p` with **full permissions** in the Obsidian vault folder (`D:\Projects\Alvin's Vault`, override with `MILI_VAULT`) and may work anywhere under its parent folder. Each job also leaves a note in the vault's `Mili jobs` folder. One-time step: run `powershell -ExecutionPolicy Bypass -File .\claude-login.ps1` to sign in. A misheard voice command can change files, so voice tasks wait 4 seconds and Ctrl+Alt+C stops them. Details: `Mili Claude Code bridge.md` in the vault.

### Learning from your files

About a minute after start, then hourly, she reads text files in the folders listed in `Documentation/data/knowledge/config.json` (created on first run: Desktop, Documents, `D:\Projects`; edit to taste) and builds `digest.md` and `personality.md` next to it. These go into her prompt at the next connection. Files with credential-like names are skipped. To make her forget, delete the `.md` and `notes.json` files in that folder. Use the panel's **Explore my files now** to trigger a pass.

## PC control (type or say these)

- **Reminders and routines:** `remind me in 10 minutes to stretch`, `remind me to call mum at 5pm`, `reminders`; `routine focus: open code; volume 20`, then just say `focus`.
- **Quick actions:** `open spotify`, `go to example.com`, `play`, `pause`, `next`, `mute`, `volume 30`, `louder`, `take a screenshot`, `switch to chrome`, `close notepad`, `lock`, `sleep`.
- **Security:** `security` shows the switches, `security lockdown|guarded|trusted|blackwall` picks a preset (default blackwall: everything on). When a switch is off she asks first (answer `yes` or `no`). **Paying always asks**, in every preset, and shutdown/restart always ask.
- **Asides while a Claude job runs:** `stop`, `status`, or `actually ...` to change the task.
- **Care nudges:** eyes, stretch, water, late-night and meal reminders while you are at the PC; `care off` / `care on`.
- **Files and screen:** `find <words>` then `open result N`; `what do you see`; `watch for <something>`; `watch along`; `stop watching`; `screen, <task>` lets her click and type through the local vision model (Ctrl+Alt+C stops her). Screenshots go only to the local Ollama model.
- Restart Mili after updating so the stage server picks this up. State is in `Documentation/data/security.json` and `reminders.json` (git-ignored).

## Settings you may want to change

| Setting | Where |
|---|---|
| Voice (VOICEVOX speaker id, speed, pitch, intonation) | `Open-LLM-VTuber\conf.yaml`, `voicevox_tts:`. List voices: http://127.0.0.1:50021/speakers |
| Back to Edge TTS | `tts_model: 'edge_tts'` in the same file |
| Persona (how she talks) | `persona_prompt` in the same file, plus `Open-LLM-VTuber\prompts\final_instructions.txt` |
| Language model | `ollama_llm.model` in the same file (`ollama pull` it first) |
| Time zone for her clock tool | `Open-LLM-VTuber\mcp_servers.json` (`--local-timezone=Asia/Bangkok`; change to yours) |
| Character model | drop a `.vrm` into `Documentation/data/models/`; stage settings are at http://localhost:8765/ |
| Start at logon | `Register-ScheduledTask` for `start-vtuber.ps1`, or put a shortcut to Mili.exe in `shell:startup` |

Edit the copies inside `Open-LLM-VTuber\`; keep `Open-LLM-VTuber-overrides\` in sync if you want the change in git.

## Everyday commands

```powershell
.\start-vtuber.ps1                 # start everything; she appears on the desktop
.\start-vtuber.ps1 -StageWindow    # the 9:16 stage in an Edge window instead of the overlay
.\stop-vtuber.ps1                  # stop Mili, the brain, the stage and VOICEVOX (add -Ollama to stop Ollama too)
```

After changing the stage code (`Documentation\app\vrm-stage\src`) or the overlay (`Documentation\app\overlay`):

```powershell
cd Documentation\app\vrm-stage; npm run build
cd ..\overlay; npm run pack        # stop Mili first, it locks the exe
```

Logs are in `Documentation\logs` (`overlay.log`, `server.*.log`, `stage.*.log`).

## Troubleshooting

| Symptom | Try |
|---|---|
| She appears but never answers | wait for the first start to finish; check `Documentation\logs\server.err.log`; confirm `ollama list` shows `qwen3-vl:8b-instruct` |
| No voice, silent replies | is VOICEVOX running? Open http://127.0.0.1:50021/version. Otherwise run `start-vtuber.ps1` again or switch to `edge_tts` |
| Tray icon says services did not start | run `start-vtuber.ps1` in a console to see the error |
| Mic does nothing | Windows Settings, Privacy, Microphone: allow desktop apps; check the default recording device |
| Typing goes to another window | click her once so the chat box takes focus, then type |
| She walks off the screen edge on a second monitor | she lives on the primary display only |
| Antivirus flags Mili.exe | it is an unsigned Electron build you made yourself; allow it or run from source with `-NoExe` |

## Repository layout

```
setup.ps1, start-vtuber.ps1, stop-vtuber.ps1   install, run, stop
Open-LLM-VTuber.patch                          our changes to the upstream brain (VOICEVOX engine, persona injection, ASR/TTS fixes)
Open-LLM-VTuber-overrides/                     our conf.yaml and prompts, copied over the brain by setup.ps1
Documentation/
  README.md, DESIGN.md, DEVLOG.md              notes, design decisions, history (v1.0 to v1.2)
  app/vrm-stage/                               3D stage (three.js, @pixiv/three-vrm), file explorer, API server
  app/overlay/                                 Electron shell, tray panel, packaging
  data/models, animations, backgrounds         avatars and VRMA clips
```

Not in git (created by `setup.ps1` or at run time): `Open-LLM-VTuber/` (upstream clone), `Mili/` (the exe), `Documentation/data/voicevox/`, `Documentation/data/knowledge/` (your private file summaries), logs.

## Credits and licences

- Brain: [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) (see its licence).
- Voice: [VOICEVOX](https://voicevox.hiroshiba.jp/) engine, speaker もち子さん by default. If you publish audio, credit the character as the VOICEVOX terms require, for example `VOICEVOX:もち子(cv 明日葉よもぎ)`, and check the terms of any other voice you pick.
- Animations: VRMA clips from the Hikari archive, see `Documentation/data/animations/LICENSE-hikari-archive.txt`.
- Avatars in `Documentation/data/models`: Taila is a user-supplied model; Seed-san and Twist-sample are VRoid and VRM samples. Check each model's own licence before redistributing it, and keep this repository private unless you have.
- PC control ideas (permission presets, reminders and routines, care nudges, lookout, computer-use loop) follow [Capri Desktop](https://github.com/lachydotmcg/capri-desktop) by lachydotmcg (PolyForm Noncommercial 1.0.0). No Capri code is copied.
- LLM: Qwen3-VL through Ollama. Speech recognition: SenseVoice through sherpa-onnx.
