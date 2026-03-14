<div align="center">

# Kova

**A terminal workspace that tracks the traces AI agents leave in your code.**

Terminal multiplexer + Git graph + AI agent monitor — in one native app.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-orange)](https://v2.tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-2021-dea584)](https://www.rust-lang.org)

<!-- TODO: Add screenshot or GIF demo here -->
<!-- ![Kova Screenshot](docs/assets/screenshot.png) -->

</div>

---

## Why Kova?

AI coding agents (Claude Code, Codex, Gemini CLI) are writing more code than ever. But tracking **who wrote what**, managing **multiple agent worktrees**, and monitoring **agent activity** requires juggling tmux, Git GUIs, and terminal windows separately.

Kova combines all three into a single native macOS app:

- **See** which commits were written by AI vs. human at a glance
- **Monitor** agent activity in real-time with auto-injected hooks
- **Manage** worktrees, branches, and merges without leaving the terminal

## Features

### Embedded Terminal with tmux
Full terminal emulator (xterm.js) with native tmux integration. Split panes, multiple windows, 12 color themes, 9 font presets.

<!-- ![Terminal](docs/assets/terminal.png) -->

### AI-Aware Git Graph
Visual git log with automatic agent attribution badges. Hover a worktree to highlight its entire branch lane. Commit detail panel with full diff viewer.

<!-- ![Git Graph](docs/assets/git-graph.png) -->

### Multi-Agent Monitoring
Supports Claude Code, Codex CLI, and Gemini CLI. Hook injection is automatic — create a project, and Kova installs the necessary hooks. Real-time notifications via native macOS alerts.

<!-- ![Notifications](docs/assets/notifications.png) -->

### Worktree Management
Create agent worktrees, assign tasks, track dirty state, and merge back to main — all from the GUI. Bidirectional cross-highlighting between worktree cards and git graph branches.

### File Explorer & Editor
Browse project files with a virtualized tree. Open files in a built-in CodeMirror editor with syntax highlighting for 60+ languages. Search file contents with grep.

### SSH Remote
Connect to remote machines over SSH. Full terminal + git graph support on remote projects, with the same UX as local.

## Quick Start

### Prerequisites

- macOS (Apple Silicon or Intel)
- [tmux](https://github.com/tmux/tmux) installed (`brew install tmux`)
- [Git](https://git-scm.com/) installed
- At least one AI coding agent: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

### Install from Source

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/kova.git
cd kova

# Install dependencies
bun install

# Run in development mode
bun tauri dev

# Build for production
bun tauri build
```

<!-- ### Install via Homebrew (coming soon)
```bash
brew install --cask kova
``` -->

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Tauri v2](https://v2.tauri.app) (Rust + WebView) |
| **Frontend** | React 19, TypeScript, Zustand, Tailwind CSS v4 |
| **Terminal** | xterm.js 6.0 + tauri-plugin-pty |
| **Git Graph** | d3-shape + Framer Motion |
| **Editor** | CodeMirror 6 |
| **Database** | SQLite (rusqlite, bundled) |
| **Backend** | Rust (serde, thiserror, tracing, tiny_http) |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  React UI                    │
│  Terminal │ Git Graph │ Files │ SSH │ Notify │
├─────────────────────────────────────────────┤
│              Tauri IPC Bridge                │
├─────────────────────────────────────────────┤
│               Rust Services                  │
│  tmux │ git │ file │ ssh │ event_server │ pty│
├─────────────────────────────────────────────┤
│        SQLite  │  tmux CLI  │  Event Server  │
└─────────────────────────────────────────────┘

Hook Flow:
  AI Agent → curl POST 127.0.0.1:{PORT}/hook → Event Server
  → Tauri emit → Event Bridge → Notification Store → macOS Alert
```

## Project Structure

```
src/                    # React frontend
├── features/           # Feature modules (project, terminal, git, ssh, ...)
├── components/         # Shared UI components (Radix + CVA)
├── stores/             # Zustand global state
└── lib/                # Tauri IPC wrappers, event bridge

src-tauri/src/          # Rust backend
├── services/           # Business logic (~10K LOC)
├── commands/           # Tauri IPC handlers
├── models/             # Data types
└── db/                 # SQLite migrations
```

## Development

```bash
# Frontend + Backend dev server with HMR
bun tauri dev

# Rust lint
cargo clippy -- -D warnings

# Frontend type check + build
bun run build

# Run tests
bun run test
cargo test
```

## Roadmap

- [ ] Interactive rebase UI
- [ ] Stash management
- [ ] Cherry-pick workflow
- [ ] GitHub/GitLab integration (issues, PRs)
- [ ] Linux support
- [ ] Homebrew Cask distribution

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

<div align="center">
Built with Tauri, React, and Rust.
</div>
