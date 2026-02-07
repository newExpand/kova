# Story 1.1: Tauri 앱 초기화 & 기본 앱 셸

Status: review

## Story

As a 개발자(사용자),
I want flow-orche 앱을 실행하면 다크 테마 기본 인터페이스가 표시되길,
So that 앱이 제대로 설치되어 사용할 준비가 되었음을 확인할 수 있다.

## Acceptance Criteria

1. **Given** 사용자가 flow-orche 앱을 최초 실행할 때 **When** 앱이 시작되면 **Then** 3초 이내에 다크 테마 기본 레이아웃(사이드바 + 메인 콘텐츠 + 상태바)이 표시된다
2. **Given** 앱이 시작될 때 **When** SQLite DB가 존재하지 않으면 **Then** `~/.flow-orche/data.db`에 자동 생성되고 projects 테이블이 마이그레이션된다
3. **Given** 앱 레이아웃이 렌더링될 때 **When** 사이드바와 메인 영역을 확인하면 **Then** 사이드바(240px)와 메인 영역이 올바르게 배치된다
4. **Given** 앱 윈도우가 표시될 때 **When** 윈도우 크기를 조절하면 **Then** 최소 크기 900x600이 적용되어 그 이하로 줄일 수 없다

## Tasks / Subtasks

- [x] Task 1: Tauri v2 + React 19 프로젝트 초기화 (AC: #1)
  - [x] 1.1: Vite + Tauri CLI로 프로젝트 초기화 (bun 사용)
  - [x] 1.2: 핵심 종속성 설치 (`zustand`, `react-router-dom`)
  - [x] 1.3: shadcn/ui 초기화 (`bunx shadcn@latest init`)
  - [x] 1.4: Tailwind CSS v4 설정 확인 및 oklch 컬러 @theme 구성
  - [x] 1.5: Rust Cargo.toml 종속성 추가 (`rusqlite`, `thiserror`, `tracing`, `serde`, `serde_json`)
  - [x] 1.6: `tauri.conf.json` 기본 설정 (윈도우 크기, 타이틀, 권한)

- [x] Task 2: SQLite DB 초기화 & 마이그레이션 (AC: #2)
  - [x] 2.1: `src-tauri/src/db/mod.rs` — DB 초기화 함수 구현 (`app.path().app_data_dir()` → `data.db`)
  - [x] 2.2: `src-tauri/src/db/migrations/001_initial.sql` — projects 테이블 + team_sessions 테이블 DDL 작성
  - [x] 2.3: `include_str!` 매크로로 마이그레이션 SQL 임베디드
  - [x] 2.4: `app.manage(DbConnection)` — Tauri Managed State로 DB 커넥션 공유
  - [x] 2.5: 앱 시작 시 자동 마이그레이션 실행 로직

- [x] Task 3: Rust 백엔드 기본 구조 생성 (AC: #1, #2)
  - [x] 3.1: `src-tauri/src/errors.rs` — `AppError` enum 정의 (thiserror 기반)
  - [x] 3.2: `src-tauri/src/models/mod.rs` — 모듈 구조 생성
  - [x] 3.3: `src-tauri/src/models/project.rs` — `Project` struct 정의 (`#[serde(rename_all = "camelCase")]`)
  - [x] 3.4: `src-tauri/src/commands/mod.rs` — Tauri Command 모듈 구조
  - [x] 3.5: `src-tauri/src/commands/project.rs` — health_check 커맨드 (DB 연결 확인)
  - [x] 3.6: `src-tauri/src/lib.rs` — 모듈 등록, Tauri 빌더 설정

- [x] Task 4: 프론트엔드 기본 레이아웃 구축 (AC: #1, #3, #4)
  - [x] 4.1: `src/index.css` — Tailwind v4 @theme 정의 (다크 테마 컬러 시스템)
  - [x] 4.2: `src/components/layout/Sidebar.tsx` — 240px 고정 사이드바 (빈 프로젝트 목록 영역)
  - [x] 4.3: `src/components/layout/PageLayout.tsx` — 사이드바 + 메인 콘텐츠 + 상태바 레이아웃
  - [x] 4.4: `src/app/App.tsx` — 앱 루트 (에러 바운더리, 프로바이더)
  - [x] 4.5: `src/app/routes.tsx` — React Router 기본 라우트 설정
  - [x] 4.6: `src/app/providers.tsx` — 전역 프로바이더 조합
  - [x] 4.7: `src/stores/appStore.ts` — 전역 Zustand store (앱 설정, UI 상태)

- [x] Task 5: 다크 테마 컬러 시스템 & 타이포그래피 (AC: #1)
  - [x] 5.1: index.css에 시맨틱 컬러 변수 정의 (Primary/Indigo, Success/Emerald, Warning/Amber, Error/Rose, Info/Sky)
  - [x] 5.2: 다크 테마 서피스 레이어 (Base: Zinc-950, Surface1: Zinc-900, Surface2: Zinc-800, Surface3: Zinc-700)
  - [x] 5.3: 타이포그래피 토큰 (Inter + JetBrains Mono)
  - [x] 5.4: shadcn/ui 테마 커스터마이즈 (다크 모드 기본)

- [x] Task 6: 윈도우 설정 & 반응형 (AC: #4)
  - [x] 6.1: `tauri.conf.json` — 최소 크기 900x600, 기본 크기 1280x800
  - [x] 6.2: 사이드바 접힘 동작 (Zustand 토글 + 240px/60px 전환)
  - [x] 6.3: 카드 그리드 반응형 열 수 (2~4열) — 빈 그리드 영역

- [x] Task 7: 통합 테스트 & 검증 (AC: #1, #2, #3, #4)
  - [x] 7.1: Rust 단위 테스트 — DB 마이그레이션 정상 실행 확인 (test_db_initialization)
  - [x] 7.2: Rust 단위 테스트 — health_check 커맨드 DB 연결 확인 (test_health_check_logic)
  - [x] 7.3: 앱 빌드 (`bunx tauri dev`) 정상 실행 확인 — 패닉 없이 기동
  - [x] 7.4: 레이아웃 시각적 확인 (사이드바 240px, 다크 테마, 최소 윈도우)

## Dev Notes

### 아키텍처 패턴 & 제약사항

**CRITICAL — 반드시 따를 것:**

1. **Rust 코드 규칙:**
   - `unwrap()` / `expect()` 절대 금지 → 모든 에러는 `?` + `AppError`로 전파
   - `#[serde(rename_all = "camelCase")]` 모든 struct에 적용
   - Tauri Command는 `snake_case` 함수명

2. **TypeScript 코드 규칙:**
   - `any` 타입 사용 금지
   - 컴포넌트에서 직접 `invoke()` 호출 금지 → specta 생성 함수 사용
   - Store 밖에서 상태 직접 변경 금지

3. **Tauri 이벤트 규칙:**
   - 패턴: `{도메인}:{동작-과거형}` (예: `app:initialized`)
   - Payload에 `timestamp` 필수
   - 이벤트는 `event-bridge/`에서만 `listen()`

4. **DB 규칙:**
   - 테이블명: `snake_case` 복수형 (`projects`, `team_sessions`)
   - 컬럼명: `snake_case` (`project_id`, `created_at`)
   - SQL 파라미터 바인딩 필수 (변수 직접 삽입 금지)

5. **JSON 직렬화:**
   - Rust `snake_case` → JSON `camelCase` (serde rename_all)

### 핵심 기술 스택 & 버전

| 기술 | 용도 | 비고 |
|------|------|------|
| Tauri v2.10+ | 앱 프레임워크 | `npm create tauri-app@latest` 최신 |
| React 19 | 프론트엔드 UI | TypeScript strict mode |
| Rust (stable) | 백엔드 | Cargo.toml 설정 |
| rusqlite | SQLite 접근 | `features = ["bundled"]` 권장 |
| thiserror | 에러 타입 | `AppError` enum |
| serde + serde_json | 직렬화 | `rename_all = "camelCase"` |
| tracing | 로깅 | `tracing-subscriber` 함께 설치 |
| Zustand | React 상태 관리 | `persist`, `subscribeWithSelector`, `devtools` |
| React Router | 라우팅 | `react-router-dom` |
| Tailwind CSS v4 | 스타일링 | `@theme` inline, oklch 컬러 |
| shadcn/ui | UI 컴포넌트 | Radix UI 기반, CSS 변수 테마 |

### DB 스키마 (001_initial.sql)

```sql
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    color_index INTEGER NOT NULL DEFAULT 0,
    account_id TEXT,
    default_prompt TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tmux_session_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT,
    stopped_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_team_sessions_project_id ON team_sessions(project_id);
```

### 다크 테마 컬러 시스템 (globals.css @theme)

```css
@theme {
  /* Primary */
  --color-primary: oklch(0.585 0.233 264);     /* Indigo #6366F1 */
  --color-primary-hover: oklch(0.65 0.215 264); /* #818CF8 */

  /* Status */
  --color-success: oklch(0.65 0.2 160);         /* Emerald #10B981 */
  --color-warning: oklch(0.75 0.18 85);          /* Amber #F59E0B */
  --color-error: oklch(0.6 0.22 25);             /* Rose #F43F5E */
  --color-info: oklch(0.65 0.17 230);            /* Sky #38BDF8 */

  /* Surface Layers (Dark Theme) */
  --color-base: oklch(0.13 0.005 285);           /* Zinc-950 #09090B */
  --color-surface-1: oklch(0.18 0.005 285);      /* Zinc-900 #18181B */
  --color-surface-2: oklch(0.23 0.005 285);      /* Zinc-800 #27272A */
  --color-surface-3: oklch(0.32 0.005 285);      /* Zinc-700 #3F3F46 */
  --color-border: oklch(0.32 0.005 285);         /* Zinc-700 #3F3F46 */

  /* Text */
  --color-text-primary: oklch(0.95 0 0);         /* Zinc-50 #FAFAFA */
  --color-text-secondary: oklch(0.7 0.005 285);  /* Zinc-400 #A1A1AA */
  --color-text-muted: oklch(0.55 0.005 285);     /* Zinc-500 #71717A */
}
```

### 레이아웃 구조

```
┌─────────────────────────────────────────────┐
│ Title Bar (Tauri 네이티브, 드래그 영역)        │
├──────────┬──────────────────────────────────┤
│          │                                  │
│ Sidebar  │         Main Content             │
│ (240px)  │                                  │
│          │  ┌────┐ ┌────┐ ┌────┐            │
│ Projects │  │Card│ │Card│ │Card│            │
│ (empty)  │  │    │ │    │ │    │            │
│          │  └────┘ └────┘ └────┘            │
│          │                                  │
│----------│──────────────────────────────────│
│ Account  │ Status Bar (계정, 연결 상태)       │
└──────────┴──────────────────────────────────┘
```

- 사이드바: 240px 고정, Zinc-900 배경
- 메인 콘텐츠: 유동 너비, Zinc-950 배경
- 상태바: 하단 고정, 글로벌 정보
- 카드 그리드: 반응형 2~4열

### Tauri 설정 핵심 (tauri.conf.json)

```json
{
  "app": {
    "windows": [
      {
        "title": "flow-orche",
        "width": 1280,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "decorations": true,
        "resizable": true
      }
    ]
  }
}
```

### Rust Managed State 패턴

```rust
// main.rs 초기화 시
app.manage(DbConnection::new(db_path)?);
app.manage(Mutex::new(TeamStateMap::new()));

// command에서 접근
#[tauri::command]
fn health_check(db: State<DbConnection>) -> Result<String, AppError> {
    // DB 연결 확인
}
```

### Project Structure Notes

- 아키텍처 문서의 디렉토리 구조를 **정확히** 따를 것 [Source: architecture.md#Project Structure & Boundaries]
- feature 기반 코로케이션 (bulletproof-react 패턴) [Source: architecture.md#Structure Patterns]
- 이 스토리에서는 `features/project/` 디렉토리 구조만 스캐폴딩 (빈 파일)
- `lib/event-bridge/`, `lib/tauri/`, `stores/` 디렉토리 생성

### References

- [Source: architecture.md#Core Architectural Decisions] — rusqlite, thiserror, tauri-specta, 이벤트 브릿지
- [Source: architecture.md#Implementation Patterns & Consistency Rules] — 네이밍, 구조, 포맷 패턴
- [Source: architecture.md#Complete Project Directory Structure] — 전체 디렉토리 트리
- [Source: prd.md#Desktop App Specific Requirements] — macOS 단독, Tauri v2
- [Source: prd.md#Non-Functional Requirements] — Cold start < 3초, UI 논블로킹
- [Source: ux-design-specification.md#Spacing & Layout Foundation] — 240px 사이드바, 900x600 최소
- [Source: ux-design-specification.md#Design Token Reference] — 다크 테마 컬러, oklch 값
- [Source: epics.md#Story 1.1] — Acceptance Criteria 원문

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- `create-tauri-app` TTY 요구 → Vite + Tauri CLI 분리 실행으로 해결
- shadcn/ui init 실패 (Tailwind config 미발견) → tsconfig paths + CSS import 추가로 해결
- npm → bun 전환 (사용자 요청)
- tracing_subscriber + tauri-plugin-log 충돌 → tracing_subscriber 제거, tauri-plugin-log 단독 사용
- macOS `timeout` 명령 부재 → background process + sleep/kill 패턴으로 대체

### Completion Notes List

- 모든 7개 Task 완료, 3개 Rust 단위 테스트 통과
- 앱 빌드 및 실행 정상 확인 (패닉 없음)
- 패키지 매니저: bun (사용자 요청에 따라 npm에서 전환)
- DB 경로: Tauri `app_data_dir()/data.db` (architecture.md 패턴 준수)
- 컬러 시스템: oklch 기반 시맨틱 변수 (UX spec 준수)
- 사이드바: 240px/60px 토글 (Zustand appStore)
- 미비 사항: 프론트엔드 단위 테스트 (vitest) 미설정 — 별도 스토리에서 처리 예정

### Change Log

| 변경 | 설명 |
|------|------|
| 프로젝트 초기화 | Tauri v2.10 + React 19 + Vite 프로젝트 생성 |
| 패키지 매니저 | npm → bun 전환 |
| Rust 백엔드 | errors, db, models, commands, services 모듈 구조 |
| SQLite | WAL 모드, 외래키, 마이그레이션 시스템 구현 |
| 프론트엔드 레이아웃 | Sidebar + PageLayout + StatusBar + ErrorBoundary |
| 상태 관리 | Zustand store (devtools + persist 미들웨어) |
| 다크 테마 | oklch 컬러 시스템, shadcn/ui 커스터마이즈 |
| 윈도우 설정 | 1280x800 기본, 900x600 최소 |

### File List

**신규 생성:**
- `vite.config.ts` — Vite 설정 (React, Tailwind, path alias)
- `src-tauri/src/errors.rs` — AppError enum (thiserror)
- `src-tauri/src/db/mod.rs` — DbConnection, 마이그레이션 시스템
- `src-tauri/src/db/migrations/001_initial.sql` — projects + team_sessions DDL
- `src-tauri/src/models/mod.rs` — 모델 모듈 배럴
- `src-tauri/src/models/project.rs` — Project struct
- `src-tauri/src/commands/mod.rs` — 커맨드 모듈 배럴
- `src-tauri/src/commands/project.rs` — health_check 커맨드
- `src-tauri/src/services/mod.rs` — 서비스 모듈 스캐폴드
- `src/app/App.tsx` — 앱 루트 (ErrorBoundary + Providers)
- `src/app/routes.tsx` — React Router 라우트
- `src/app/providers.tsx` — 전역 프로바이더
- `src/stores/appStore.ts` — Zustand 글로벌 store
- `src/components/layout/Sidebar.tsx` — 사이드바 (240px/60px)
- `src/components/layout/PageLayout.tsx` — 메인 레이아웃
- `src/components/layout/StatusBar.tsx` — 하단 상태바
- `src/lib/event-bridge/index.ts` — 이벤트 브릿지 스캐폴드
- `src/lib/tauri/commands.ts` — Tauri IPC 래퍼
- `src/lib/utils.ts` — shadcn cn() 유틸
- `src/features/{project,team,preset,notification,account,terminal,environment}/index.ts` — 7개 feature 배럴 export

**수정:**
- `src-tauri/Cargo.toml` — 종속성 추가 (rusqlite, thiserror, uuid, chrono 등)
- `src-tauri/src/lib.rs` — 모듈 등록, Tauri 빌더 구성
- `src-tauri/src/main.rs` — lib 이름 변경
- `src-tauri/tauri.conf.json` — 윈도우 설정, bun 빌드 명령
- `src/index.css` — Tailwind v4 + oklch 다크 테마
- `src/main.tsx` — App 컴포넌트 연결
- `index.html` — dark class, 한국어 lang, 타이틀
- `package.json` — 이름/버전/스크립트/종속성
- `tsconfig.json` / `tsconfig.app.json` — path alias
