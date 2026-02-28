# Clew Project Rules

## 1. Architecture Overview

- **Tech Stack**: Tauri v2 + React 19 + Rust + SQLite + tmux integration
- **Purpose**: macOS desktop app for managing Claude Code Agent Teams
- **Data Flow**: React <-> Tauri IPC <-> Rust Services <-> SQLite / tmux CLI / Event Server

### 1.1 Directory Structure
```
src-tauri/src/
├── lib.rs          # Tauri setup, command registration, event server start
├── main.rs         # Desktop entry point
├── errors.rs       # AppError enum (thiserror)
├── db/             # SQLite: connection, migrations
├── models/         # Data types (Project, TmuxSession, etc.)
├── services/       # Business logic (project CRUD, hooks, tmux, event_server, notification)
└── commands/       # Tauri IPC handlers (thin wrappers)

src/
├── app/            # App.tsx, providers.tsx, routes.tsx
├── features/       # project/, notification/, tmux/, environment/
├── components/     # ui/, layout/
├── lib/            # tauri/commands.ts, event-bridge/, utils.ts
├── stores/         # appStore.ts (Zustand)
└── hooks/          # useGlobalShortcuts.ts
```

### 1.2 Platform Constraints

- **WKWebView**: macOS Tauri uses WKWebView which blocks external CDN resources. Always use bundled/local assets (npm packages, fontsource, etc.) instead of CDN links.
- **Terminal**: The project uses xterm.js 6.0 with DOM renderer. `@xterm/addon-canvas` 0.7.0 is incompatible with xterm 6.0. Terminal transparency must be achieved through CSS on the DOM renderer's actual viewport elements (`.xterm-viewport`, `.xterm-screen`), not through canvas addons.
- **tmux**: The app manages tmux programmatically via Rust. When fixing tmux-related behavior, check BOTH `.tmux.conf` configuration AND the Rust source code's programmatic tmux API calls (`split-window`, `new-window` commands). Config-only fixes are often insufficient.

## 2. Rust Coding Rules

- **NEVER use `unwrap()` or `expect()`** — use `?` operator with `AppError`
- Return `Result<T, AppError>` from all fallible functions
- Log errors with `tracing::error!` before returning. No `println!` in production code.
- **SQL**: ALWAYS use `?` positional or `:name` named parameters. NEVER concatenate user input into SQL strings.
- **Serde**: `#[serde(rename_all = "camelCase")]` REQUIRED on all IPC structs
- **IPC**: Register ALL commands in `generate_handler![]`. Use `State<'_, Mutex<T>>` for shared state.
- **PRAGMAs**: `foreign_keys = ON; journal_mode = WAL; synchronous = NORMAL;`

## 3. Frontend Coding Rules

- **No `any` type** — use explicit types or generics
- Define all Tauri command types in `lib/tauri/commands.ts`. Components NEVER call `invoke()` directly.
- Events only via `lib/event-bridge/`. Components NEVER call `listen()` directly.
- **Zustand** store structure: State -> Computed -> Actions -> Reset. Every async action needs `isLoading` flag + `finally` cleanup.
- **Feature modules**: ALL imports from `features/` MUST go through `index.ts` barrel exports.

## 4. Event Server

- Flow: Claude Code Hook → curl POST `127.0.0.1:{PORT}/hook` → tiny_http (Rust thread) → `app.emit` → Event Bridge → notificationStore → macOS native alert
- Port file: `~/.flow-orche/event-server.port`
- Server binds to `127.0.0.1` ONLY (never `0.0.0.0`)

## 5. Security Rules

### 5.1 High Risk
- **Event Server**: 127.0.0.1 only
- **SQL**: ALWAYS `?` params (NEVER format!/concat)
- **Hooks**: `serde_json::to_string()` (NEVER string concat)
- **File Writes**: Atomic (temp + rename), permissions 0600

### 5.2 Input Validation
- Canonicalize project paths before DB insert
- Validate hook types against enum
- JSON parse errors return 400 (not 500)

## 6. Build Commands

```bash
cargo build                        # Rust compile
cargo clippy -- -D warnings        # Rust lint
bun run build                      # Frontend build
bun tauri dev                      # Dev mode with HMR
```

## 7. Critical Checklist

Before committing:
- [ ] `cargo build` passes
- [ ] `bun run build` passes
- [ ] All commands registered in `generate_handler![]`
- [ ] All SQL queries use `?` parameters
- [ ] No `unwrap()`/`expect()` in production code
- [ ] No `any` type in TypeScript
- [ ] Event server binds to `127.0.0.1`
- [ ] Error types implement custom `Serialize`
