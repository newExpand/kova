# flow-orche Project Rules

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

### 1.2 File Ownership Boundaries
- **Lead-only files**: lib.rs, mod.rs, index.ts, routes.tsx, CLAUDE.md, configs
- **Agent-owned files**: Each agent's task specifies its files (no overlap)
- **Shared integration**: Agents provide integration notes, Lead applies them

## 2. Rust Coding Rules

### 2.1 Error Handling
```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Custom Serialize for Tauri
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
```

- **NEVER use `unwrap()` or `expect()`** -> use `?` operator with AppError
- Return `Result<T, AppError>` from all fallible functions
- Log errors with `tracing::error!` before returning

### 2.2 SQL Security
```rust
// CORRECT: Parameterized queries only
conn.execute(
    "INSERT INTO projects (name, path) VALUES (?1, ?2)",
    params![name, path]
)?;

// INCORRECT: NEVER do this
// let query = format!("SELECT * FROM projects WHERE name = '{}'", input);
```

- **ALWAYS use `?` positional or `:name` named parameters**
- **NEVER concatenate user input into SQL strings**
- Enable: `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`

### 2.3 Tauri IPC Patterns
```rust
#[tauri::command]
pub fn create_project(
    name: String,           // Owned types (not &str)
    path: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<String, AppError> {
    let conn = state.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    services::project::create(&conn.conn, &name, &path)
}
```

- Register ALL commands in `generate_handler![]`
- Use `State<'_, Mutex<T>>` for shared state
- Return `Result<T, AppError>` for proper error handling

### 2.4 Serde Conventions
```rust
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]  // REQUIRED on all IPC structs
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color_index: i32,
    pub is_active: bool,
    pub created_at: String,
}
```

### 2.5 Logging
```rust
use tracing::{info, warn, error};
info!("Starting event server on port {}", port);
warn!("Retrying tmux command (attempt {}/3)", attempt);
error!("Database migration failed: {}", err);
```
- **No `println!` in production code** -- use tracing

## 3. Frontend Coding Rules

### 3.1 TypeScript Safety
- **No `any` type** -- use explicit types or generics
- Define all Tauri command types in `lib/tauri/commands.ts`
- Match Rust struct field names (camelCase via serde)

### 3.2 Tauri IPC Wrappers
```typescript
// lib/tauri/commands.ts
import { invoke } from '@tauri-apps/api/core';

export async function createProject(name: string, path: string): Promise<string> {
    return await invoke<string>('create_project', { name, path });
}
// Components NEVER call invoke() directly
```

### 3.3 Event Bridge Pattern
```typescript
// lib/event-bridge/index.ts
import { listen } from '@tauri-apps/api/event';

export function initEventBridge() {
    listen('notification:hook-received', (event) => {
        // update store
    });
}
// Components NEVER call listen() directly
```

### 3.4 Zustand State Management
```typescript
interface ProjectStore {
    // 1. State
    projects: Project[];
    selectedId: string | null;
    isLoading: boolean;
    error: string | null;
    // 2. Computed
    getProjectById: (id: string) => Project | undefined;
    // 3. Actions
    fetchProjects: () => Promise<void>;
    createProject: (input: CreateProjectInput) => Promise<void>;
    deleteProject: (id: string) => void;
    // 4. Reset
    reset: () => void;
}
```
- Structure: State -> Computed -> Actions -> Reset
- Every async action: `isLoading` flag + `finally` cleanup
- Feature imports only through `index.ts` barrel exports

### 3.5 Feature Module Pattern
```
features/project/
├── components/     # UI components
├── hooks/          # useProjects.ts
├── stores/         # projectStore.ts
├── types.ts        # TypeScript types
└── index.ts        # BARREL EXPORT (public API)
```
- **ALL imports from features MUST go through `index.ts`**

## 4. Database Schema

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    color_index INTEGER DEFAULT 0 CHECK (color_index >= 0 AND color_index <= 7),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_projects_active ON projects(is_active) WHERE is_active = 1;
```

## 5. Event Server

```
Claude Code Hook -> curl POST http://127.0.0.1:{PORT}/hook?project={path}&type={Type}
  -> tiny_http server (Rust thread)
  -> app.emit("notification:hook-received", HookEvent)
  -> Event Bridge (React) -> notificationStore
  -> Tauri notification API -> macOS native alert
```
- Port file: `~/.flow-orche/event-server.port`
- Server binds to `127.0.0.1` ONLY (never `0.0.0.0`)

## 6. Security Rules

### 6.1 High Risk
- **Event Server**: 127.0.0.1 only
- **SQL**: ALWAYS `?` params (NEVER format!/concat)
- **Hooks**: `serde_json::to_string()` (NEVER string concat)
- **File Writes**: Atomic (temp + rename), permissions 0600

### 6.2 Input Validation
- Canonicalize project paths before DB insert
- Validate hook types against enum
- JSON parse errors return 400 (not 500)

## 7. Build Commands

```bash
cargo build                        # Rust compile
cargo clippy -- -D warnings        # Rust lint
bun run build                      # Frontend build
bun tauri dev                      # Dev mode with HMR
```

## 8. Critical Checklist

Before committing:
- [ ] `cargo build` passes
- [ ] `bun run build` passes
- [ ] All commands registered in `generate_handler![]`
- [ ] All SQL queries use `?` parameters
- [ ] No `unwrap()`/`expect()` in production code
- [ ] No `any` type in TypeScript
- [ ] Event server binds to `127.0.0.1`
- [ ] Error types implement custom `Serialize`
