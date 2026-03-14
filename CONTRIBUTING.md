# Contributing to Kova

Thanks for your interest in contributing to Kova! This guide will help you get started.

## Prerequisites

Kova is a **macOS-only** desktop app. You'll need:

| Tool | Version | Install |
|------|---------|---------|
| macOS | 13+ (Ventura) | — |
| Rust | 1.75+ | [rustup.rs](https://rustup.rs) |
| Bun | 1.0+ | [bun.sh](https://bun.sh) |
| tmux | 3.0+ | `brew install tmux` |

Verify your setup:

```bash
rustc --version   # 1.75+
bun --version     # 1.0+
tmux -V           # tmux 3.0+
```

## Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/kova.git
cd kova

# 2. Install dependencies
bun install

# 3. Run in dev mode (starts both Vite HMR + Tauri)
bun tauri dev

# 4. Verify builds pass
cargo build                    # Rust
bun run build                  # Frontend (tsc + vite)
cargo clippy -- -D warnings    # Rust lint
```

## Project Structure

```
src-tauri/src/
├── lib.rs          # Tauri setup, command registration
├── errors.rs       # AppError enum (thiserror)
├── db/             # SQLite connection, migrations
├── models/         # Data types
├── services/       # Business logic
└── commands/       # Tauri IPC handlers (thin wrappers)

src/
├── features/       # Feature modules (project, tmux, notification, etc.)
├── components/     # Shared UI components
├── lib/            # Tauri commands, event bridge, utilities
├── stores/         # Zustand stores
└── hooks/          # React hooks
```

For full architecture details, see [CLAUDE.md](CLAUDE.md).

## Coding Rules

### Rust

- **No `unwrap()` or `expect()`** — use `?` with `AppError`
- Return `Result<T, AppError>` from all fallible functions
- SQL queries must use `?` positional parameters — never string concatenation
- `#[serde(rename_all = "camelCase")]` on all IPC structs

### TypeScript

- **No `any` type** — use explicit types or generics
- Tauri commands go through `lib/tauri/commands.ts` — components never call `invoke()` directly
- Events go through `lib/event-bridge/` — components never call `listen()` directly
- Feature imports must go through `index.ts` barrel exports

### Security

- Event server binds to `127.0.0.1` only (never `0.0.0.0`)
- SQL: always parameterized queries
- File writes: atomic (temp + rename), permissions `0600`

## Making Changes

### 1. Create a branch

```bash
git checkout -b feat/your-feature   # or fix/your-fix
```

### 2. Make your changes

Follow the coding rules above. When in doubt, check [CLAUDE.md](CLAUDE.md) for the full checklist.

### 3. Test your changes

```bash
cargo build                    # Rust compiles
cargo clippy -- -D warnings    # No lint warnings
bun run build                  # Frontend compiles
bun run test                   # Unit tests pass
```

### 4. Commit

Write clear commit messages:

```
feat: add worktree status indicators
fix: prevent duplicate tmux sessions on rapid clicks
docs: update keyboard shortcuts section
```

Format: `type: description` where type is one of:
`feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### 5. Open a Pull Request

- Fill in what changed and why
- Link related issues if applicable
- Ensure all checks pass

## Reporting Issues

When filing an issue, please include:

- **macOS version** and **Kova version**
- Steps to reproduce
- Expected vs actual behavior
- Console logs if applicable (`Cmd+Option+I` in dev mode)

## Architecture Notes

A few things to keep in mind:

- **WKWebView**: macOS Tauri uses WKWebView which blocks external CDN resources. Always use bundled assets (npm packages, fontsource, etc.).
- **tmux integration**: When fixing tmux behavior, check both `.tmux.conf` and the Rust code's programmatic tmux API calls. Config-only fixes are often insufficient.
- **Terminal**: Uses xterm.js 6.0 with DOM renderer. Canvas addons are not compatible.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
