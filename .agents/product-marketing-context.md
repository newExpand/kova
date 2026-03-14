# Product Marketing Context

*Last updated: 2026-03-14*

## Product Overview
**One-liner:** A native terminal workspace with visual tmux/worktree management and AI agent awareness.
**What it does:** Kova is a macOS desktop app that wraps tmux and git worktree in a visual GUI, adds a built-in git graph with agent attribution badges, and monitors AI coding agents in real-time. It solves the terminal stability issues (memory leaks, UI corruption, IME bugs) that plague existing terminals under AI agent workloads.
**Product category:** Developer tools — terminal workspace
**Product type:** Open-source desktop application (macOS native via Tauri v2)
**Business model:** Free and open-source (MIT license). No paid tier currently planned.

## Target Audience
**Target companies:** Individual developers, small dev teams, AI-forward engineering orgs
**Decision-makers:** Individual developers who use tmux, git worktree, or AI coding agents daily
**Primary use case:** Using tmux and git worktree through a visual interface while monitoring AI agent activity — without leaving the terminal
**Jobs to be done:**
- Manage tmux panes and windows visually instead of memorizing CLI commands
- Create, track, and merge git worktrees with one click instead of multi-step CLI workflows
- See which commits were written by AI vs. human at a glance in the git graph
- Monitor AI agent sessions (Claude Code, Codex, Gemini CLI) from a single dashboard
**Use cases:**
- Splitting tmux panes, creating windows, and managing sessions through GUI buttons instead of keyboard shortcuts
- Creating a worktree for an AI agent task, watching its progress, and merging back to main — all visually
- Running 3+ Claude Code agents on different features simultaneously, tracking each one's progress
- Reviewing a git history where half the commits were AI-generated, needing to know which ones
- SSHing into a remote dev server and getting the same terminal + git visualization
- Korean developers needing stable IME input that doesn't break in WKWebView

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| tmux user who wants GUI | Keyboard-driven workflow, but also visual feedback | tmux is powerful but invisible — no visual pane/window management, no git integration | Visual tmux management + git graph + file explorer in one app |
| AI agent power user | Productivity, visibility into agent output | Can't track which agent wrote what, agents finish without notification, memory leaks in terminals | Agent attribution, real-time monitoring, stable terminal for long sessions |
| Git worktree user | Parallel branch development | Worktree CLI is verbose, no visual status, merging is manual multi-step process | One-click worktree creation, dirty state badges, visual merge workflow |
| Tech lead reviewing AI code | Code quality, accountability | No way to distinguish AI-generated commits from human commits in git log | Agent attribution badges on every commit in the graph |

## Problems & Pain Points
**Core problem:**
Existing terminals (VSCode, iTerm, Ghostty) aren't built for AI agent workloads — long-running sessions cause memory leaks (100GB+) and UI corruption after `/clear`. tmux and git worktree are powerful but have steep CLI learning curves. And there's no way to track which code was written by which AI agent.

Kova solves all three: a stable terminal + tmux/worktree GUI + AI agent awareness.

**Why alternatives fall short:**
- **VSCode terminal**: Memory accumulation under heavy agent use, UI breaks after /clear, no tmux integration, no git worktree management
- **iTerm2/Ghostty**: No git graph, no worktree visualization, no agent hooks, no activity monitoring
- **tmux alone**: Powerful but invisible — no GUI for pane/window management, no git integration, steep learning curve
- **Git GUIs (GitKraken, Fork)**: No terminal integration, no AI agent awareness, no worktree-branch cross-highlighting
- **Trellis/Claude Code CLI**: CLI-only, no visual worktree management, no multi-agent overview
- **Warp**: AI features built in but no git graph, no agent attribution, no hook system, no worktree management
**What it costs them:** Terminal crashes and memory leaks during long agent sessions. Time lost on tmux/worktree CLI commands. No visibility into which code needs human review.
**Emotional tension:** "My terminal is using 50GB of memory after 2 hours of agent work." / "I can't remember the git worktree commands." / "3 agents finished and I didn't notice for 20 minutes."

## Competitive Landscape
**Direct:** No direct competitor combines terminal + visual tmux + git graph + AI agent monitoring in one native app.
**Secondary:** Trellis (@mindfoldhq) — CLI-based Claude Code workflow tool, but no GUI, no git visualization, no multi-agent monitoring.
**Secondary:** Warp terminal — modern terminal with AI features, but no git graph, no agent attribution, no worktree management.
**Secondary:** lazygit — TUI git client, but no terminal multiplexing, no AI awareness, no worktree visualization.
**Indirect:** Using tmux + GitKraken + browser tabs separately — works but fragmented.

## Differentiation
**Key differentiators:**
- Visual tmux management — GUI buttons for pane split/close, window create/switch, session lifecycle (16 features built)
- Visual git worktree management — one-click creation, dirty state badges, merge-to-main workflow, bidirectional branch cross-highlighting
- Agent attribution badges on git commits (auto-detected from Co-Authored-By trailers)
- Terminal stability — Korean IME fixes (3 iterations), CPU spike fix (120% → normal), memory leak prevention, sleep/wake crash fix
- Zero-config hook injection (create project → hooks installed automatically for Claude/Codex/Gemini)
- Codex monitoring without hook support (pgrep-based pane monitor as workaround)
- 4-layer terminal multiplexing (App → PTY → tmux → shell) with session persistence across app restarts
- Built-in file explorer with CodeMirror editor, Cmd+P search, Cmd+Click import navigation, git diff decorations
**How we do it differently:** Native macOS app (Tauri v2 + Rust backend) instead of Electron. All processing is local — no cloud, no telemetry, no accounts.
**Why that's better:** Fast startup, low memory, works offline, zero privacy concerns. Your code never leaves your machine.
**Why customers choose us:** "tmux and worktree are finally usable without memorizing commands, and I can see what my agents are doing."

## Objections
| Objection | Response |
|-----------|----------|
| "macOS only?" | Linux support is on the roadmap. The architecture (Tauri v2) already supports cross-platform — it's a packaging effort, not a rewrite. |
| "Why not just use tmux + lazygit?" | Kova adds visual tmux management (GUI pane/window controls), worktree lifecycle management, and AI agent attribution/monitoring. If you don't need visuals or agent awareness, tmux + lazygit is a great combo. |
| "Another Electron app?" | Kova uses Tauri v2 (Rust + native WebView), not Electron. Binary is ~15MB vs Electron's ~150MB+. Memory usage is 3-5x lower. |
| "Is the terminal stable enough for daily use?" | 22+ stability fixes shipped — Korean IME, CPU spikes, memory leaks, sleep/wake crashes, copy-mode quirks all resolved. |

**Anti-persona:** Developers who don't use tmux or AI coding agents, and are happy with their current terminal + Git GUI setup. If your workflow doesn't involve tmux sessions or AI agents, Kova adds complexity you don't need.

## Switching Dynamics
**Push:** "My VSCode terminal ate 100GB of memory again after running Claude Code for 2 hours." / "I can never remember the git worktree add/remove/merge commands." / "I have 4 terminal windows and a Git GUI open just to manage my agents."
**Pull:** "One app where tmux is visual, worktrees are one-click, and I can see all my agents' git activity. Hooks install themselves."
**Habit:** "I already have my tmux config dialed in. I know my Git GUI shortcuts. Switching feels risky."
**Anxiety:** "Will it break my tmux sessions? Will the hooks interfere with my agents? Is it stable enough for daily use?"

## Customer Language
**How they describe the problem:**
- "My terminal crashes when I run agents for too long"
- "I can never remember tmux shortcuts"
- "git worktree commands are too verbose for how often I use them"
- "I can't tell which commits were written by AI"
- "My agent finished 10 minutes ago and I didn't notice"
**How they describe us:**
- "It's tmux with a GUI"
- "Like a visual git worktree manager with a terminal built in"
- "Mission control for AI coding agents"
- "I can finally see what my agents are doing"
**Words to use:** workspace, terminal, visual tmux, git worktree, agent tracking, native, stable, fast, local
**Words to avoid:** orchestration (implies complex infrastructure), IDE (it's not an IDE), lightweight (undersells the features), simple (it's powerful, not simple), AI-powered (Kova doesn't use AI — it monitors AI agents)
**Glossary:**
| Term | Meaning |
|------|---------|
| Agent attribution | Auto-detecting AI-authored commits via Co-Authored-By git trailers |
| Hook injection | Automatically installing webhook scripts that notify Kova when agents start/stop/complete |
| Worktree | Git feature allowing multiple branches checked out simultaneously in separate directories |
| Pane monitor | Background process that detects Codex agent activity via process inspection (workaround for missing hook API) |
| Visual tmux | GUI-based tmux pane/window management — buttons instead of keyboard shortcuts |

## Brand Voice
**Tone:** Technical but approachable. Speaks developer-to-developer.
**Style:** Direct, concise, show-don't-tell. Lead with the demo GIF, not paragraphs of text.
**Personality:** Competent, pragmatic, no-nonsense, open-source-minded

## Proof Points
**Metrics:**
- 13K+ lines of Rust, 4.5K+ lines of TypeScript
- 45+ IPC commands, 9 feature domains
- 22+ terminal stability fixes (IME, memory, CPU, sleep/wake)
- 16 tmux GUI features (pane, window, session management)
- 14 git worktree features (creation, merge, visualization)
- 12 terminal themes, 9 font presets
- Supports 3 AI agent types (Claude Code, Codex CLI, Gemini CLI)
**Customers:** Pre-launch (open source release pending)
**Testimonials:** None yet (pre-launch)
**Value themes:**
| Theme | Proof |
|-------|-------|
| Stability | 22+ fixes for memory leaks, CPU spikes, IME bugs, sleep/wake crashes |
| Accessibility | tmux GUI (16 feats), worktree one-click management (14 feats), Cmd+P/⌘0-9 shortcuts |
| Visibility | Agent attribution badges, real-time activity monitoring, worktree-branch cross-highlighting |
| Unification | Terminal + Git + Files + SSH in one native app |
| Performance | Tauri v2 native app, LRU memory pooling, lazy-loaded code chunks |

## Goals
**Business goal:** Establish Kova as the go-to terminal workspace for developers who use tmux, git worktree, and AI coding agents. Build an open-source community.
**Conversion action:** GitHub star → clone → daily use → contribution
**Current metrics:** Pre-launch. Target: 500+ GitHub stars in first month post-launch.
