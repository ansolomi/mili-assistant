# Handoff: Mili (vtuber-assistant)

Date: 2026-11-01. Written so a new session can continue from this file. History is in `Documentation/DEVLOG.md`, install steps in `README.md`, the vault note is `D:\Projects\Alvin's Vault\Mili.md` and `Mili Claude Code bridge.md`.

## What it is
A Windows desktop VTuber companion, built to be a companion and an agent. A VRM character (Taila-HD.vrm) in a transparent click-through Electron overlay (Mili.exe) walks the taskbar, perches on window edges, reacts to the cursor, talks by text or voice in Japanese, and can run Claude Code.

Stack: Open-LLM-VTuber brain :12393, Ollama `qwen3-vl:8b-instruct` :11434 (`qwen2.5:14b` is installed but unused), SenseVoice ASR, VOICEVOX TTS :50021 (speaker 20), VRM stage Node server :8765 (`Documentation/app/vrm-stage`), overlay `Documentation/app/overlay`.

Git: https://github.com/ansolomi/mili-vtuber (private, branch main). Everything below is pushed (HEAD 14e0211 at the time of writing).

## State
- v1.3 to v1.5 done: Claude Code bridge, mic button on the model, eased head tracking, HD textures (Taila-HD.vrm, original untouched), animation expansion (dances, naps, mood and job reactions, procedural gestures), skirt spring physics plus follow-the-legs step, headpat on the stage page, persistent Claude Code room, `/api/say` reverse channel, `cloud, <task>` send-only.
- Each feature was checked live (CDP script or browser pane) when it was added. Not checked: a long random-behaviour run, mood and job reactions firing on their own, spoken trigger accuracy, `setup.ps1` end to end, a real tray click, the mic button and headpat by hand, the skirt while walking.

## Claude Code bridge (no LLM in the path)
- Typed `claude, <task>` fires at once. Spoken "hey claude, ..." or "クロード、..." interrupts her and starts after 4 s. `cloud, <task>` is typed only. Ctrl+Alt+C cancels.
- Jobs run `claude -p ... --dangerously-skip-permissions --add-dir D:\Projects` with cwd = the vault. All jobs resume one session (id in `Documentation/data/claude-session.json`, git-ignored). `GET/POST /api/claude/session` shows or resets it. Open it by hand with `claude --resume <id>` from the vault folder.
- Jobs know nothing about this chat: say real paths. A job that cannot resolve a name stops and asks (job "Mili's Room" did).
- Reverse: `POST http://localhost:8765/api/say {"text":"..."}` makes her say it (localhost only, drained every 2 s).
- Cloud: `claude -p msg --cloud <session-id>` queues a task in an existing cloud session (id in `Documentation/data/cloud-session.json`, git-ignored, or env `MILI_CLOUD_SESSION`). Send-only, no reply to her; read it at claude.ai/code. Creating a cloud session is interactive only.
- Each job leaves a note in `D:\Projects\Alvin's Vault\Mili jobs`. The claude.exe of the store (MSIX) desktop app is found by `findExe()` in `claude.js`.

## Jarvis link and images (v1.6, branch feat/mili-jarvis-link)
- Typed `jarvis, <task>` in the chat box calls `POST /api/jarvis` in `server.js`, which forwards to the Jarvis bridge (`http://127.0.0.1:8787/ask`, env `JARVIS_URL`). Jarvis is a separate project at `D:\Projects\jarvis-code` (start with `start-jarvis.bat`); vault note `Jarvis.md`. Tier 3 has restricted tools, so it is the safer route than `claude,`.
- Pasting an image into `#ovChat` uploads it to `POST /api/image`, saved under `<vault>\Inbox\images`, and the path is appended to the text. Only `claude,` and `jarvis, /work` can read it; her local qwen3-vl does not get it.
- `server.js` now returns 403 when Host or Origin is not localhost/127.0.0.1 on the stage port (a website could previously start full-permission jobs).
- Checked live: image upload, `/api/jarvis` Tier 1 and Tier 3 (read text out of an uploaded image). Not checked: typing `jarvis,` or pasting in the overlay by hand, the spoken path (none exists).

## Run and rebuild
- Start: `start-vtuber.ps1` (Ollama, VOICEVOX, brain, stage, exe). Stop: `stop-vtuber.ps1`.
- Stage code change: `cd Documentation/app/vrm-stage; npm run build`, then restart the stage server (a changed server.js or claude.js needs a node restart, a rebuilt page needs the overlay reloaded; restarting Mili.exe alone does not restart the server if it is already up).
- Exe: stop Mili first, then `cd Documentation/app/overlay; npm run pack`.
- Debug: launch Mili.exe with `--remote-debugging-port=9444` (9333 was held by a ghost process). The overlay page exposes `stage` and `window.mili` (`play`, `perform`, `nap`, `perch`, `react`). Browser pane preview: `http://localhost:8765/?model=Taila-HD.vrm&ws=ws://localhost:1/` (the `ws=` stops it connecting to the brain). The pane needs a real viewport size (`resize_window`) before pointer maths works.
- Logs: `Documentation/logs`. Ports: 8765, 12393, 11434, 50021. Ollama needs `OLLAMA_CONTEXT_LENGTH=16384`.

## Quirks worth knowing
- three-vrm spring bones rewrite bone quaternions each `vrm.update`, so any extra rotation must be applied after it (`skirtFollowLegs`).
- Dance clips from other rigs sink her, so hip position tracks are dropped for `dance_*`.
- Animation sources are Mixamo-looking (see `Documentation/data/animations/README.txt`): keep the repo private until their terms are checked.
- Not in git: `Open-LLM-VTuber/` (upstream 992309c plus `Open-LLM-VTuber.patch`; our `conf.yaml` and prompts live in `Open-LLM-VTuber-overrides/`), the claude and cloud session files, models other than the committed ones.
- Shell tooling: backslashes collapse in bash heredocs (use Write/Edit); no `python3` in bash; `run_in_terminal` takes one literal line (put scripts in .ps1).

## Open items and ideas
- Hair is still rigid: spring physics for the DEF-hair bones was offered, not requested.
- Headpat exists on the stage page only; the overlay has none (a long hover would clash with click to chat and drag).
- The 8B model gets weekdays wrong and sometimes adds a stray acknowledgement ("了解です！") before a job report; the 14B is a one-line swap in `conf.yaml` (untested, no vision).
- Cloud answers cannot be read back by her; look for a way to fetch them if she should report them.
- Spoken trigger: SenseVoice may hear "Claude" as "cloud"; the spoken regex accepts cloud, clod, claud.
- She lives on the primary display only. `setup.ps1` is untested end to end.
- Possible next features: obsidian-aware reminders, hair physics, overlay headpat, a spoken "cancel" command.

## Decisions the user owns
- Whether to keep the project private (animation licences).
- Whether to move her brain to the 14B.
- Whether the cloud room should ever get a reply channel.
