# flow-orche

macOS 데스크톱 앱 — Tauri v2 + React 19 + Rust + SQLite + tmux 기반 Claude Code Agent Teams 오케스트레이터

## 문서 참조

| 문서 | 경로 | 용도 |
|------|------|------|
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | 전체 아키텍처 결정, 디렉토리 트리, FR↔파일 매핑 |
| PRD | `_bmad-output/planning-artifacts/prd.md` | 33개 FR, NFR, 기능 상세 |
| Epics | `_bmad-output/planning-artifacts/epics.md` | 에픽/스토리 분해, 구현 순서 |
| UX Spec | `_bmad-output/planning-artifacts/ux-design-specification.md` | UI/UX 상세, 컬러 토큰, 컴포넌트 |

## 기술 스택

| 레이어 | 기술 | 버전 | 비고 |
|--------|------|------|------|
| 프레임워크 | Tauri | v2.10+ | Shell Plugin, IPC, 권한 시스템 |
| 프론트엔드 | React | 19 | TypeScript strict mode |
| 스타일 | Tailwind CSS + shadcn/ui | v4 | oklch, @theme inline, 다크 기본 |
| 상태 관리 | Zustand | latest | persist, subscribeWithSelector, devtools |
| 라우팅 | React Router | latest | URL params, 코드 스플리팅 |
| 빌드 | Vite | latest | HMR, 프론트엔드 번들링 |
| 백엔드 | Rust | stable | 비동기 처리, 프로세스 관리 |
| DB | SQLite (rusqlite) | latest | 임베디드 마이그레이션, `include_str!` |
| IPC 타입 | tauri-specta | v2 | Rust→TS 타입 자동 생성 |
| 에러 | thiserror | latest | 통합 에러 enum `AppError` |
| 로깅 | tracing + Tauri Log Plugin | — | Rust 전역 로깅 |
| 터미널 | ghostty-web (WASM) | — | xterm.js API 호환, ~400KB |
| 프로세스 | tmux + Claude Code CLI | — | send-keys 제어, Agent Teams 모드 |

## 필수 규칙

### Rust

- `unwrap()` / `expect()` **금지** → `?` + `AppError`로 전파
- `#[serde(rename_all = "camelCase")]` 모든 직렬화 struct에 필수
- Command는 `Result<T, AppError>` 반환, 별도 래퍼 없음
- `commands/` → `services/` → `db/` 단방향 의존만 허용
- 외부 프로세스 호출만 재시도 (최대 3회, 1초 간격), 내부 로직 재시도 금지
- 매 재시도마다 `tracing::warn!` 로깅

### TypeScript

- `any` 타입 **금지**
- `invoke()` 직접 호출 **금지** → `lib/tauri/commands.ts` (specta 생성 함수) 사용
- `console.log` 프로덕션 잔류 **금지** → `tracing` 사용
- 모든 비동기 액션에 로딩 상태 (`is*ing`) + `finally` 해제 필수

### IPC / 이벤트

- 이벤트 `listen()`은 `lib/event-bridge/` 에서만 — 컴포넌트 직접 구독 금지
- 이벤트 Payload에 `projectId` + `timestamp` 항상 포함
- 이벤트명 패턴: `{도메인}:{동작-과거형}` (예: `team:state-changed`)
- Rust→React: `app.emit()`, React→Rust: specta 함수

### DB

- SQL 파라미터 바인딩 필수 — 변수 직접 삽입 금지
- 테이블명 `snake_case` 복수형, 컬럼 `snake_case`
- 날짜 저장: ISO 8601 (`2026-02-07T14:30:00Z`)
- 마이그레이션: `src-tauri/src/db/migrations/` 에 임베디드 SQL

### 상태 관리

- Store 밖에서 상태 직접 변경 금지
- Store 구조 순서: State → Computed (`get*`) → Actions (동사) → Reset
- Action 네이밍: `handle*` (이벤트 반응), `동사*` (사용자 액션)
- 미들웨어 순서: `devtools` > `subscribeWithSelector` > `persist`(필요시)
- 하나의 feature = 하나의 store 파일

### 모듈 / 구조

- feature 간 import는 `index.ts` 배럴만 통해서 — 직접 import 금지
- 공유 코드는 `components/`, `lib/`, `stores/`에만 위치
- Tauri Managed State로 DB 커넥션 + TeamState 공유 (`app.manage()`)

## 반패턴 (NEVER)

| 금지 | 대안 |
|------|------|
| `unwrap()` / `expect()` | `?` + `AppError` |
| `any` 타입 (TS) | 명시적 타입 또는 제네릭 |
| 컴포넌트에서 `invoke()` 직접 호출 | specta 생성 함수 (`lib/tauri/commands.ts`) |
| 컴포넌트에서 `listen()` 직접 호출 | `lib/event-bridge/` 모듈 |
| Store 밖 상태 변경 | Zustand action 사용 |
| SQL 변수 직접 삽입 | 파라미터 바인딩 (`?`) |
| `console.log` 프로덕션 | `tracing` |
| feature 간 직접 import | `index.ts` 배럴 export |
| 내부 로직 재시도 | 외부 프로세스만 재시도 |
| 전역 로딩 상태 | 액션별 독립 로딩 (`is*ing`) |

## 프로젝트 구조 (핵심)

```
src/
  app/                  ← 라우터, 프로바이더, 에러 바운더리
  features/             ← 도메인별 모듈 (project, team, preset, notification, account, terminal, environment)
    {feature}/
      components/       ← feature 전용 컴포넌트
      hooks/            ← feature 전용 훅
      stores/           ← feature 전용 Zustand store
      types.ts          ← feature 전용 타입
      index.ts          ← 배럴 export (외부 공개 API)
  components/ui/        ← shadcn/ui 공유 컴포넌트
  components/layout/    ← Sidebar, Header, PageLayout
  lib/event-bridge/     ← 중앙 이벤트 브릿지 (도메인별 파일)
  lib/tauri/            ← specta 생성 타입/함수
  stores/               ← 전역 store (appStore, networkStore)

src-tauri/src/
  commands/             ← Tauri Command (IPC 진입점)
  services/             ← 비즈니스 로직 (tmux, claude, state_machine)
  models/               ← 데이터 구조체
  db/                   ← DB 초기화, migrations/
  errors.rs             ← AppError (thiserror)
```

## 네이밍 규칙

| 영역 | 규칙 | 예시 |
|------|------|------|
| DB 테이블 | `snake_case` 복수형 | `team_presets` |
| DB 컬럼 | `snake_case` | `created_at`, `project_id` |
| DB 외래키 | `{참조_단수}_id` | `preset_id` |
| DB 인덱스 | `idx_{테이블}_{컬럼}` | `idx_projects_name` |
| Rust struct/enum | `PascalCase` | `TeamState` |
| Rust 함수 | `snake_case` | `spawn_team` |
| Rust 상수 | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| TS 컴포넌트 | `PascalCase` (파일도) | `ProjectCard.tsx` |
| TS 함수/변수 | `camelCase` | `getProject` |
| TS 훅 | `use` 접두사 | `useTeamStore` |
| TS 상수 | `SCREAMING_SNAKE_CASE` | `MAX_PROJECTS` |
| TS 유틸 파일 | `camelCase.ts` | `formatDate.ts` |
| 이벤트명 | `{도메인}:{동작-과거형}` | `team:state-changed` |
| 이벤트 Payload | `camelCase` JSON | `{ projectId, timestamp }` |
| JSON 직렬화 | `camelCase` (serde rename) | Rust `snake` → JSON `camel` |

## 스킬 참조 (시나리오별)

### Tauri & IPC 개발
- `/tauri-v2` — Tauri 설정, Command 작성, IPC 패턴, 권한 설정
- `/integrating-tauri-rust-frontends` — Rust↔프론트엔드 통합

### Rust 백엔드
- `/rust-best-practices` — Rust 코드 작성 전 반드시 참조 (에러 핸들링, API 설계)

### UI / 스타일링
- `/tailwind-v4-shadcn` — Tailwind v4 + shadcn/ui 셋업, @theme inline, CSS 변수
- `/accessibility-compliance` — WCAG 2.2, 모바일 접근성, 보조 기술
- `/frontend-design` — 고품질 프론트엔드 인터페이스 구현

### 상태 관리
- `/zustand-state-management` — Zustand store 설계, 미들웨어, persist, SSR

### 라우팅
- `/frontend-react-router-best-practices` — React Router 로더, 액션, 폼, 데이터 페칭

### 빌드 / 번들링
- `/react-vite-best-practices` — Vite 설정, React 최적화, 코드 스플리팅

### 데이터베이스
- `/sqlite-database-expert` — SQLite 마이그레이션, FTS, SQL 인젝션 방지, Tauri 연동

### 타입 시스템
- `/typescript-advanced-types` — 제네릭, 조건부 타입, 매핑 타입, 유틸리티 타입

### 테스팅
- `/vitest` — 단위/통합 테스트, 모킹, 커버리지, 필터링

### 보안
- `/api-security-best-practices` — 인증, 인가, 입력 검증, Rate Limiting

### 개발 프로세스
- `/commit` — git 커밋
- `/review-pr` — PR 리뷰
- `/feature-dev` — 가이드 기반 기능 개발
- `/systematic-debugging` — 체계적 디버깅
- `/test-driven-development` — TDD 워크플로우

## 핵심 아키텍처 패턴

- **IPC 흐름**: Component → specta 함수 → Tauri IPC → Rust Command → Service → DB/Process
- **이벤트 흐름**: Rust `app.emit()` → Tauri Event → `event-bridge/` → Zustand Store → React 리렌더
- **상태 머신**: Rust enum (`TeamState`) + exhaustive match, 상태 변경 시 이벤트 발행
- **에러 흐름**: `thiserror` enum → serde 직렬화 → 프론트엔드 에러 바운더리/catch

## 개발 명령어

```bash
cargo tauri dev                                                    # 개발 서버
cargo tauri build                                                  # 프로덕션 빌드 (DMG)
cargo test --manifest-path src-tauri/Cargo.toml                    # Rust 테스트
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings   # Rust 린트
npx vitest run                                                     # 프론트엔드 테스트
npx eslint src/                                                    # 프론트엔드 린트
```
