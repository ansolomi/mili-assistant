# VTuber Desktop Assistant: Draft Design (v0)

Goal: a VTuber avatar living on this Windows PC that chats like a friend, remembers you, learns new routines over time, and can operate Claude Code, Word and other apps on your behalf.

## 1. What the references do (and what to take)

| Project | Relevant strengths | Take / skip |
|---|---|---|
| [Open-LLM-VTuber](https://docs.llmvtuber.com/en/docs/intro/) | Modular LLM/ASR/TTS via config, Live2D with backend-driven expressions, MCP tool calling, screen/camera vision, Letta-based long-term memory, desktop-pet mode (transparent, always-on-top, click-through) | Take: module interfaces, pet-mode idea. Easiest base to fork for the "face". |
| [Super Agent Party](https://github.com/heshengtao/super-agent-party) | VRM/Live2D, MCP + Agent Skills + A2A tools, Task Center with permission modes (read-only to full autonomy), Claude Code file ops, mouse/keyboard/terminal control, screenshot-then-act browser (~3-5s/step) | Take: permission modes, background task center. Skip: AGPL license, large surface area. |
| [AIRI (moeru-ai)](https://github.com/moeru-ai/airi) | Neuro-sama style, Live2D + VRM, game/app awareness, MIT | Take: event-driven "presence" ideas. Check repo before relying. |
| [Neuro (kimjammer)](https://www.sourcepulse.org/projects/2179289) | Small local pipeline: RealtimeSTT, RealtimeTTS, any OpenAI-compatible LLM | Take: low-latency streaming voice loop as a minimal reference. |
| "Cindy" | Not found by search | Send me the link if you want it covered. |
| [Hermes Agent](https://yuv.ai/blog/hermes-agent) (secondary sources only) | Turns finished tasks into reusable skills, SQLite FTS5 history, file memory (MEMORY.md/USER.md) plus pluggable provider ([Mem0](https://docs.mem0.ai/integrations/hermes)) | Take: the learning loop pattern. Verify against official repo. |
| Windows control: [Windows-MCP](https://playbooks.com/mcp/cursortouch/windows-mcp), [pywinauto-mcp](https://github.com/sandraschi/pywinauto-mcp), [terminator](https://enterprisedna.co/directories/mcp/louis030195-terminator-mcp-agent) | UI Automation tree (stable) instead of pixel clicking | Take: UIA-first, vision as fallback. |

## 2. Key decision: "learns on her own" means no model training

Fine-tuning weights on a PC is fragile and slow. Practical self-learning is:

1. **Memory**: facts and preferences extracted from conversations.
2. **Skills**: when a task succeeds, she writes a reusable recipe (steps, tools, UI selectors) and reloads it next time.
3. **Reflection**: nightly job reviews the day's logs, merges duplicate memories, prunes stale ones, proposes new skills.
4. **Optional later**: LoRA on persona/voice style from curated chats. Not v1.

## 3. Architecture

```
 Avatar layer (Electron/Tauri window, transparent, click-through, Live2D/VRM)
        ^ expression + lip-sync events (WebSocket)
 Gateway (Python, FastAPI)  <-- one event bus: user_text, user_audio, screen_event, task_update
   |-- Voice: VAD -> faster-whisper (ASR) ... streaming TTS (GPT-SoVITS / Edge / Fish)
   |-- Persona/Chat brain: LLM (Claude API or local Ollama), persona card, emotion tags
   |-- Memory: SQLite+FTS5 (episodes) + vector store (facts) + MEMORY.md/USER.md (curated)
   |-- Skill store: markdown/YAML skills, versioned, searchable
   |-- Agent core: planner loop with permission gate
   |      |-- Tool: Claude Code (subprocess, `claude -p` / Agent SDK) for coding tasks
   |      |-- Tool: Office via COM (pywin32) / python-docx for Word, Excel
   |      |-- Tool: Windows-MCP / UIA for generic apps, vision fallback
   |      |-- Tool: browser (Playwright), shell (sandboxed), files
   |-- Scheduler: reflection job, reminders, proactive check-ins
```

Design rules:
- **Two brains, one persona.** A fast chat model answers in real time. A separate agent loop runs tasks in the background and reports back in her voice. Chat never blocks on a 5-minute task.
- **Everything is a tool behind MCP** where possible, so tools are swappable and reusable by Claude Code too.
- **Tool preference order**: API/COM/CLI first, UI Automation second, screenshot clicking last.
- **Emotion channel**: LLM emits tags (`[happy]`, `[think]`) mapped to Live2D expressions and motions.

## 4. Safety (non-negotiable for a PC-controlling agent)

- Permission tiers per tool: `observe` (read/screenshot), `ask` (confirm each time), `auto` (allowed list only). Default new skills to `ask`.
- Hard denies: deleting outside a workspace, sending email/messages, purchases, credential fields, system settings.
- Visible indicator and a global hotkey to halt the agent immediately.
- Full action log (what she did, with screenshots) stored for the reflection job and for your review.
- Memory writes of learned skills require approval for the first N uses.
- Treat screen text, web pages and documents as data, not instructions (prompt injection).

## 5. Phased plan

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | Fork/run Open-LLM-VTuber, pick a Live2D model, get voice chat working | Validate latency and persona. Days. |
| 1 | Own gateway + persona + SQLite memory, desktop-pet window | Decide fork vs rewrite here. |
| 2 | Agent core with permission gate; Claude Code tool; Word via COM | First real "assistant" value. |
| 3 | UIA/vision tool for other apps; screen awareness | Use Windows-MCP as the backend. |
| 4 | Skill learning + nightly reflection | The "learns on her own" piece. |
| 5 | Proactivity, wake word, polish, optional LoRA | |

## 6. Open questions for you

1. **Live2D (2D) or VRM (3D)?** Live2D has more free ecosystem; VRM allows 3D movement.
2. **LLM**: Claude API (best agent quality, costs money) or local Ollama (private, weaker tool use)? Hybrid is possible.
3. **Fork or from scratch?** Fork Open-LLM-VTuber for speed (license is MIT-style, check), or own gateway for control. Recommendation: fork for phase 0, decide at phase 1.
4. **Voice**: cloud TTS quality vs local GPT-SoVITS for a custom voice. GPU available?
5. **Tech stack for avatar window**: Electron (what the references use) vs Tauri.

## 6b. Decisions (2026-10-27) and local feasibility

Decided: Live2D, Claude API (haiku tier for chat latency), fork Open-LLM-VTuber for phase 0 (cloned to `Open-LLM-VTuber/`, `conf.yaml` set to `claude_llm`).

Machine: Ryzen 5 7500F (6C/12T), 31 GB RAM, RX 6800 XT (16 GB VRAM per spec; Windows WMI misreports 4 GB), Windows 10.

| Component | Runs locally? | Notes |
|---|---|---|
| Live2D avatar + server + MCP | Yes, trivial | Light CPU/browser GPU load. |
| LLM (Claude API) | Cloud, no local load | Needs network and an API key; cost scales with tool use. |
| ASR (sherpa-onnx SenseVoice / faster-whisper) | Yes on CPU | Real-time on this CPU; GPU not needed. |
| VAD (Silero) | Yes | Negligible. |
| TTS: Edge TTS | Cloud, free | Quickest start. |
| TTS: GPT-SoVITS / local clone | Doubtful | CUDA-centric; AMD on Windows means DirectML/CPU, slower than real time. Defer. |
| Local LLM fallback (Ollama) | Yes | 6800 XT is on Ollama's ROCm list; 7-14B Q4 models fit in 16 GB. Weaker tool use than Claude. |
| Agent tools (COM, UIA, Claude Code) | Yes | CPU bound, small. |

Verdict: feasible. The only AMD-related limit is custom local voice cloning; everything else is CPU or cloud. Expect roughly 1.5-3 s to first audio with cloud LLM + Edge TTS.

### Current state (2026-10-28)

- Stack running: Open-LLM-VTuber fork, Ollama `qwen3-vl:8b-instruct` (vision, 16K ctx via `OLLAMA_CONTEXT_LENGTH`), Kokoro multilingual TTS via sherpa-onnx (patched `sherpa_onnx_tts.py`), SenseVoice ASR forced to `en`, desktop client v1.2.1 installed.
- `run_server.py` uses uvicorn `ws="websockets-sansio"`: the legacy websockets impl crashed with `AssertionError` in `_drain_helper` when sending Kokoro's large WAV audio.
- Persona "Mili" is in `conf.yaml` (`persona_prompt`). Time MCP timezone is `Asia/Bangkok`.
- Known issue: with the app's prompts the model writes tool calls as text (`[get_current_time(...)]`) instead of calling them, and answers time questions from memory. Direct Ollama calls with a simple prompt do produce real tool calls. Date/time is now injected into the system prompt at connection (`construct_system_prompt` in `service_context.py`), so time questions work. Web search via tools is still unverified; candidate fix is a separate agent step for tool use (phase 2).

- Auto-start: scheduled task `VTuberAssistant` (at logon, 20 s delay) runs `start-vtuber.ps1` (Ollama, then server, then desktop client; logs in `logs/`). `stop-vtuber.ps1` stops the client and server. Remove with `Unregister-ScheduledTask VTuberAssistant`.

## 7. Risks

- Agent reliability on GUI apps is the weakest link; keep COM/CLI paths for Word and Claude Code.
- Latency budget: aim under 1.5s to first audio; needs streaming at every stage.
- Memory bloat and wrong memories; needs the reflection/pruning job and a way to view and edit memory.
- License: Super Agent Party is AGPL; do not copy code from it into a closed project.
- Some source claims above come from secondary blogs and directory listings; verify in each repo before committing to a dependency.
