---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - product-brief-flow-orche-2026-02-06.md
  - prd.md
  - ux-design-specification.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-02-07'
project_name: 'flow-orche'
user_name: 'flow-orche'
date: '2026-02-07'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

33개 FR이 7개 도메인으로 구성됨:

| 도메인 | FR 범위 | 수량 | Phase | 아키텍처 영향 |
|--------|---------|------|-------|-------------|
| 프로젝트 관리 | FR1~FR5 | 5 | 1a | SQLite CRUD, React 상태 관리 |
| 팀 실행/제어 | FR6~FR14 | 9 | 1a | **핵심** — tmux 프로세스 관리, 비동기 스폰, 상태 머신 |
| 팀 프리셋 관리 | FR15~FR18 | 4 | 1a | SQLite 저장, JSON 프리셋 구조 |
| 알림 | FR19~FR22 | 4 | 1b | Claude hooks 파일 감시, macOS 알림 통합 |
| 계정 관리 | FR23~FR27 | 5 | 1b | macOS Keychain, claude auth CLI 위임 |
| 환경/Onboarding | FR28~FR30 | 3 | 1a | 시스템 의존성 감지 (CLI 존재 확인) |
| 데이터/오프라인 | FR31~FR33 | 3 | 1a | SQLite 로컬 저장, 네트워크 독립 UI |

**Non-Functional Requirements:**

| 영역 | 핵심 기준 | 아키텍처 영향 |
|------|----------|-------------|
| 성능 | Cold start < 3초, 전체 런치 < 20초, UI 논블로킹 | Rust 비동기 처리, 옵티미스틱 UI, 경량 SQLite |
| 보안 | Keychain 토큰 저장, OAuth CLI 위임, 평문 금지 | Tauri 권한 시스템, Rust 시크릿 관리 |
| 통합 안정성 | tmux 99%, Claude Code 90%+, hooks 지연 < 5초 | 재시도 로직, 타임아웃, fallback 전략 |
| 오프라인 | 로컬 CRUD 가능, Claude 기능만 비활성 | 네트워크 상태 감지, 기능별 활성/비활성 |

**Scale & Complexity:**

- Primary domain: macOS 데스크톱 앱 (시스템 통합 중심)
- Complexity level: Medium-High — 외부 프로세스 통합 불확실성
- Estimated architectural components: ~12~15개 주요 모듈

### Technical Constraints & Dependencies

| 제약/의존성 | 유형 | 영향도 | 비고 |
|------------|------|--------|------|
| Tauri v2 (v2.10+) | 프레임워크 | 높음 | 권한 시스템, IPC, 플러그인 생태계가 아키텍처 결정 |
| React 19 | 프론트엔드 | 중간 | Tauri 웹뷰 내 렌더링, shadcn/ui 컴포넌트 |
| SQLite | 데이터 저장 | 중간 | Tauri SQL 플러그인 또는 Rust 직접 접근 |
| tmux CLI | 핵심 통합 | **높음** | send-keys 기반 제어, 세션 라이프사이클 전체 의존 |
| Claude Code CLI | 핵심 통합 | **높음** | 실행, Agent Teams 모드, 프롬프트 감지 |
| Claude Code Hooks | 알림 통합 | 중간 | 파일시스템 이벤트, Phase 1b |
| ghostty-web (WASM) | 터미널 | 중간 | tmux 세션 attach → 웹뷰 렌더링, xterm.js API 호환 |
| macOS Keychain | 보안 | 낮음 | 토큰 저장, Tauri 보안 API 활용 |
| macOS 13+ Ventura | 플랫폼 | 낮음 | Tauri v2 최소 요구사항 |

### Cross-Cutting Concerns Identified

1. **비동기 프로세스 라이프사이클** — tmux 세션 생성→Claude 실행→팀 스폰→모니터링→정리. 모든 팀 관련 기능이 이 라이프사이클에 의존. 상태 머신 패턴 필수.

2. **Rust↔React IPC 상태 동기화** — 백엔드(Rust)에서 관리하는 프로세스 상태가 프론트엔드(React)에 실시간 반영되어야 함. 이벤트 기반 통신 패턴.

3. **에러 핸들링 & 복구** — tmux 실패, Claude Code 타임아웃, hooks 감시 실패 등 다양한 실패 모드. 각각에 대한 재시도/fallback/사용자 안내 전략.

4. **오프라인/온라인 상태 관리** — 네트워크 독립 로컬 기능과 네트워크 의존 Claude 기능의 명확한 분리.

5. **프로세스 격리** — 다중 프로젝트 동시 실행 시 각 tmux 세션의 독립성 보장, 한 프로젝트 실패가 다른 프로젝트에 영향 없음.

### Technology Stack Validation (Context7 검증)

| 기술 | 판정 | 근거 |
|------|------|------|
| **Tauri v2** | ✅ 유지 | Shell Plugin(spawn+이벤트), IPC Commands, Event System이 핵심 요구사항 충족 |
| **React 19** | ✅ 유지 | Tauri 웹뷰 최적, shadcn/ui 생태계 |
| **SQLite** | ✅ 유지 | Tauri SQL Plugin 지원, 로컬 데이터 저장 최적 |
| **ghostty-web** | ✅ 유지 | WASM 파서, ~400KB, xterm.js API 호환(드롭인 교체 가능), Mux(유사 에이전트 앱)에서 검증 |
| **shadcn/ui + Tailwind v4** | ✅ 유지 | oklch 컬러 + @theme inline 최신 패턴, Command(cmdk) 내장 |
| **Zustand** | ✅ **추가** | 클라이언트 상태 관리 — subscribeWithSelector로 Tauri 이벤트→React 상태 동기화, persist로 UI 설정 유지 |
| **TanStack Query** | ❌ 불필요 | 로컬 SQLite 데이터에 서버 캐싱 레이어 불필요, 오버헤드만 추가 |
| **TanStack DB** | ❌ 시기상조 | MVP에 과도한 추상화, API 미안정 |

## Starter Template Evaluation

### Primary Technology Domain

macOS 데스크톱 앱 (Tauri v2 + React 19) — 시스템 통합 중심의 하이브리드 아키텍처

### Starter Options Considered

| 옵션 | 스타터 | 강점 | 약점 | 판정 |
|------|--------|------|------|------|
| A | dannysmith/tauri-template | tauri-specta, 이벤트 브릿지, preferences, 알림/업데이트/로깅 내장 | shadcn/ui 미포함, Tailwind v4 미확인, 독자적 패턴 과다 | 참조용 |
| B | MrLightful/create-tauri-react | shadcn/ui 내장, bulletproof-react 구조, ESLint/Prettier/Husky | Tailwind v4 미확인, Tauri-specific 패턴 부족 | 참조용 |
| C | agmmnn/tauri-ui | shadcn/ui + 네이티브 윈도우 컨트롤 | Tauri 2 + Tailwind v4 미지원 이슈 (2025-04), 유지보수 불안정 | 제외 |
| **D** | **Official create-tauri-app** | **항상 최신 Tauri v2.10+**, 아키텍처 완전 제어 | 초기 셋업 수동 | **선택** |

### Selected Starter: Official create-tauri-app + 수동 구성

**Rationale for Selection:**

1. **최신 버전 보장** — `create-tauri-app@latest`는 항상 최신 Tauri v2.10+ 제공
2. **Tailwind v4 직접 설치** — UX 스펙의 oklch/@theme inline 패턴 정확히 적용 가능
3. **아키텍처 완전 제어** — 불필요한 패턴 제거, 프로젝트 설계에 맞는 구조만 적용
4. **커뮤니티 템플릿 버전 락 회피** — Tailwind v3/Tauri v1에 머물러 있는 리스크 제거
5. **참조 패턴 채택** — dannysmith의 이벤트 브릿지, bulletproof-react의 코드 구조를 선별 적용

**Initialization Command:**

```bash
npm create tauri-app@latest flow-orche -- --template react-ts
cd flow-orche
npm install zustand
npx shadcn@latest init
```

### Architectural Decisions Provided by Starter

**Language & Runtime:**
- TypeScript 5.x (strict mode) — 프론트엔드
- Rust (stable) — 백엔드

**Styling Solution:**
- Tailwind CSS v4 (@theme inline, oklch 컬러 모델)
- shadcn/ui (Radix UI 기반, CSS 변수 테마)
- 다크 테마 기본

**Build Tooling:**
- Vite (프론트엔드 빌드, HMR)
- Cargo (Rust 백엔드 빌드)
- Tauri CLI (통합 빌드, 번들링)

**State Management:**
- Zustand (persist, subscribeWithSelector, devtools 미들웨어)
- Tauri Events → Zustand store 동기화 패턴

**Testing Framework:**
- Vitest (프론트엔드 단위/통합 테스트)
- cargo test (Rust 백엔드 테스트)

**Code Organization:**
- bulletproof-react 참조 구조: features/, components/, hooks/, stores/, lib/
- Rust: src-tauri/src/ 모듈별 command 구성

**Development Experience:**
- Vite HMR (프론트엔드 핫 리로드)
- ESLint + Prettier (코드 품질)
- Clippy (Rust 린팅)

### Reference Patterns from Community Templates

| 패턴 | 출처 | 적용 방식 |
|------|------|----------|
| tauri-specta (타입-세이프 IPC) | dannysmith/tauri-template | Rust command→TypeScript 타입 자동 생성 검토 |
| 이벤트 기반 Rust→React 브릿지 | dannysmith/tauri-template | 프로세스 상태 동기화에 적용 |
| bulletproof-react 코드 구조 | create-tauri-react | features/ 기반 모듈 구성 |
| 네이티브 윈도우 컨트롤 | agmmnn/tauri-ui | tauri-controls 라이브러리 참조 |

**Note:** 프로젝트 초기화는 첫 번째 구현 스토리로 진행.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (구현 차단):**
- rusqlite + 임베디드 마이그레이션 (데이터 레이어 전체가 의존)
- Tauri Shell Plugin spawn + enum 상태 머신 (팀 실행/제어 FR6~FR14 전체가 의존)
- tauri-specta IPC 타입 생성 (Rust↔React 모든 통신이 의존)
- 중앙 이벤트 브릿지 (실시간 상태 동기화 전체가 의존)

**Important Decisions (아키텍처 형성):**
- React Router 라우팅 (화면 구조)
- feature 기반 코로케이션 (코드 조직)
- thiserror 통합 에러 타입 (에러 처리 일관성)
- macOS Keychain + claude auth CLI 위임 (Phase 1b 계정 관리)
- Tauri Log Plugin + tracing (디버깅 인프라)

**Deferred Decisions (Post-MVP):**
- 자동 업데이트 (Tauri Updater Plugin) — 코드 서명/공증 선행 필요
- Homebrew Cask 배포 — 사용자 규모 확인 후

### Data Architecture

| 결정 | 선택 | 버전 | 근거 |
|------|------|------|------|
| SQLite 접근 | rusqlite 직접 사용 | latest stable | Rust 백엔드 완전 제어, Tauri Command로 프론트엔드 노출 |
| 데이터 모델링 | 코드 우선 (Rust struct → 테이블) | — | 간단한 마이그레이션 스크립트 관리 |
| 마이그레이션 | 임베디드 SQL (`include_str!`) | — | 앱 시작 시 자동 실행, 의존성 없음 |

### Authentication & Security

| 결정 | 선택 | 근거 |
|------|------|------|
| 토큰 저장 | macOS Keychain (Tauri Security API) | OS 레벨 암호화, PRD 명시 |
| 인증 플로우 | `claude auth` CLI 직접 위임 | CLI 인증 변경에 자동 대응, 복잡도 최소 |
| 권한 관리 | 최소 권한 원칙 | 플러그인/커맨드별 명시적 허용 |

### API & Communication Patterns

| 결정 | 선택 | 근거 |
|------|------|------|
| IPC 패턴 | tauri-specta | Rust command→TypeScript 타입 자동 생성, 타입 안전성 |
| 에러 핸들링 | thiserror 통합 에러 enum | 에러 코드 + 사용자 메시지 분리, 직렬화 전달 |
| 프로세스 통신 | Tauri Shell Plugin `spawn` | CommandEvent 이벤트 스트림, Tauri 공식 지원 |
| 상태 머신 | Rust enum 수동 상태 머신 | exhaustive match 컴파일 안전성, 선형 흐름에 적합, 의존성 없음 |

### Frontend Architecture

| 결정 | 선택 | 근거 |
|------|------|------|
| 라우팅 | React Router | URL params, 히스토리, 코드 스플리팅 내장 |
| 컴포넌트 구조 | feature 기반 코로케이션 | PRD 7개 도메인 매핑, bulletproof-react 패턴 |
| 이벤트 동기화 | 중앙 이벤트 브릿지 (모듈 분리) | `event-bridge/` 디렉토리, feature별 파일, 디버깅 용이 |

### Infrastructure & Deployment

| 결정 | 선택 | 근거 |
|------|------|------|
| 배포 | DMG + GitHub Releases | Tauri 번들러 자동 생성, MVP 적합 |
| CI/CD | GitHub Actions + tauri-action | 빌드/서명/번들링 원스텝 자동화 |
| 자동 업데이트 | MVP 제외 → Phase 2 | 코드 서명/공증 선행 필요 |
| 로깅 | Tauri Log Plugin + Rust `tracing` | tmux 프로세스 디버깅 필수, Rust 생태계 표준 |
| 환경 설정 | Tauri 설정 + 환경 변수 | Tauri 기본 제공, 별도 크레이트 불필요 |

### Decision Impact Analysis

**Implementation Sequence:**
1. rusqlite + 임베디드 마이그레이션 셋업 (데이터 레이어 기반)
2. tauri-specta IPC 타입 생성 파이프라인 (Rust↔React 통신 기반)
3. Tauri Shell Plugin + enum 상태 머신 (팀 프로세스 관리 핵심)
4. 중앙 이벤트 브릿지 + Zustand store 연결 (실시간 동기화)
5. React Router + feature 구조 스캐폴딩 (UI 프레임)
6. thiserror 에러 체계 + tracing 로깅 (운영 인프라)
7. GitHub Actions CI/CD 파이프라인 (빌드 자동화)
8. macOS Keychain 계정 관리 (Phase 1b)

**Cross-Component Dependencies:**
- tauri-specta → 모든 Tauri Command에 영향 (IPC 타입 생성 방식 결정)
- 중앙 이벤트 브릿지 → Zustand store 구조에 영향 (이벤트 → 상태 매핑)
- enum 상태 머신 → 이벤트 브릿지 + UI 상태 표시에 영향 (상태 변경 이벤트 발행)
- rusqlite → Tauri Command 설계에 영향 (데이터 접근 패턴)

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5개 카테고리, 20+ 영역에서 AI 에이전트 간 충돌 가능성 식별 및 해결

### Naming Patterns

**Database Naming Conventions:**
- 테이블명: `snake_case`, 복수형 — `projects`, `team_presets`, `accounts`
- 컬럼명: `snake_case` — `project_id`, `created_at`, `is_active`
- 외래키: `{참조테이블_단수}_id` — `project_id`, `preset_id`
- 인덱스: `idx_{테이블}_{컬럼}` — `idx_projects_name`

**Rust Code Naming Conventions:**
- Struct/Enum: `PascalCase` — `TeamState`, `ProjectConfig`
- 함수/메서드: `snake_case` — `get_project`, `spawn_team`
- 상수: `SCREAMING_SNAKE_CASE` — `MAX_RETRY_COUNT`
- Tauri Command: `snake_case` — `#[tauri::command] fn get_project()`

**TypeScript/React Code Naming Conventions:**
- 컴포넌트: `PascalCase` — `ProjectCard`, `TeamStatus`
- 파일명: `PascalCase.tsx` (컴포넌트), `camelCase.ts` (유틸/훅)
- 함수/변수: `camelCase` — `getProject`, `teamState`
- 훅: `use` 접두사 — `useTeamStore`, `useProjectList`
- 상수: `SCREAMING_SNAKE_CASE` — `MAX_PROJECTS`
- 타입/인터페이스: `PascalCase` — `Project`, `TeamPreset`

**Tauri Event Naming Conventions:**
- 패턴: `{도메인}:{동작}` colon 구분, 과거형 — `team:state-changed`, `process:output-received`
- Payload: `camelCase` JSON — `{ projectId, newState, timestamp }`
- 모든 Payload에 `projectId` + `timestamp` 포함 필수

**JSON Serialization:**
- Rust struct: `snake_case` (Rust 관례)
- 직렬화(serde): `#[serde(rename_all = "camelCase")]` — JSON은 항상 `camelCase`
- TypeScript: `camelCase` (자연스럽게 매칭)

### Structure Patterns

**Frontend Project Organization:**

```
src/
  app/                    ← 앱 진입점, 라우터 설정, 프로바이더
  features/               ← 도메인별 모듈 (핵심)
    project/
      components/         ← feature 전용 컴포넌트
      hooks/              ← feature 전용 훅
      stores/             ← feature 전용 Zustand store
      types.ts            ← feature 전용 타입
      index.ts            ← public API (re-export)
    team/
    preset/
    notification/
    account/
  components/             ← 공유 UI (shadcn/ui 기반)
    ui/                   ← shadcn 컴포넌트 (Button, Dialog 등)
    layout/               ← 레이아웃 컴포넌트 (Sidebar, Header)
  lib/                    ← 공유 유틸리티
    event-bridge/         ← Tauri 이벤트 브릿지 모듈
    tauri/                ← Tauri IPC 래퍼 (specta 생성)
  stores/                 ← 전역 Zustand store (앱 설정, UI 상태)
  styles/                 ← 글로벌 CSS, Tailwind 설정
```

**Rust Backend Organization:**

```
src-tauri/src/
  main.rs                 ← Tauri 앱 초기화
  lib.rs                  ← 모듈 등록
  commands/               ← Tauri Command 모듈
  models/                 ← 데이터 구조체
  services/               ← 비즈니스 로직 (tmux, claude, state_machine)
  db/                     ← DB 초기화, 커넥션, migrations/
  errors.rs               ← thiserror 에러 타입
```

**Test Location:**
- 프론트엔드: 코로케이션 — `features/project/components/ProjectCard.test.tsx`
- Rust: `#[cfg(test)] mod tests` 인라인 + `src-tauri/tests/` 통합 테스트

**Module Rules:**
- 각 feature의 `index.ts`만 외부에 노출 (배럴 export)
- feature 간 직접 import 금지 → 반드시 `index.ts` 통해서
- 공유 코드는 `components/`, `lib/`, `stores/`에만 위치

### Format Patterns

**Tauri Command Response:**
- `Result<T, AppError>` 직접 반환, 별도 래퍼 없음
- tauri-specta가 TypeScript 타입 자동 생성

**Error Response Structure:**

```rust
#[derive(thiserror::Error, Debug, Serialize)]
pub enum AppError {
    #[error("프로젝트를 찾을 수 없습니다: {0}")]
    NotFound(String),
    #[error("tmux 세션 생성 실패: {0}")]
    TmuxError(String),
    #[error("데이터베이스 오류: {0}")]
    DbError(String),
}
```

**Date/Time Format:**
- DB 저장: ISO 8601 문자열 — `2026-02-07T14:30:00Z`
- Rust↔React 전달: ISO 8601 문자열
- UI 표시: 상대 시간 (`3분 전`) 또는 로컬 포맷 (`2월 7일 오후 2:30`)

### Communication Patterns

**Event System:**
- Rust → React: `app.emit("{도메인}:{동작-과거형}", payload)`
- 이벤트 브릿지에서만 `listen()` — 컴포넌트 직접 구독 금지
- 이벤트 브릿지 모듈 분리: `event-bridge/{도메인}-events.ts`

**Zustand Store Pattern:**
- Store 구조 순서: State → Computed (`get*`) → Actions (동사) → Reset
- Action 네이밍: `handle*` (이벤트 반응), `동사*` (사용자 액션)
- 미들웨어 순서: `devtools` > `subscribeWithSelector` > `persist`(필요시)
- 하나의 feature = 하나의 store 파일

### Process Patterns

**Error Handling:**
- Rust: `?` 연산자 + `From` trait으로 에러 전파, `unwrap()` 금지
- React: 앱 레벨 에러 바운더리 1개, feature별 catch는 Command 호출 지점에서
- 사용자 메시지와 기술 로그 분리 — `tracing::error!`는 기술 상세, UI는 한국어 안내

**Loading State:**
- 네이밍: `is{동작}ing` — `isLaunching`, `isStopping`, `isLoading`
- 전역 로딩 없음 — 액션별 독립 로딩
- `finally` 블록에서 반드시 해제

**Retry Pattern:**
- 외부 프로세스(tmux, Claude CLI)만 재시도, DB/내부 로직은 재시도 안 함
- 최대 3회, 1초 간격
- 매 재시도마다 `tracing::warn!` 로깅

### Enforcement Guidelines

**All AI Agents MUST:**
1. Rust `snake_case`, TypeScript `camelCase`, serde `rename_all = "camelCase"` 변환 일관 적용
2. feature 간 import는 반드시 `index.ts` 배럴을 통해서만
3. Tauri 이벤트는 이벤트 브릿지에서만 `listen()`, 컴포넌트 직접 구독 금지
4. `unwrap()` / `expect()` 사용 금지 — 모든 에러는 `?` + `AppError`로 전파
5. 모든 비동기 액션에 로딩 상태 (`is*ing`) 및 `finally` 해제 포함
6. 외부 프로세스 호출에만 재시도 (최대 3회), 내부 로직 재시도 금지
7. 이벤트 Payload에 `projectId` + `timestamp` 항상 포함

**Anti-Patterns (금지):**
- `any` 타입 사용 (TypeScript)
- 컴포넌트에서 직접 `invoke()` 호출 — specta 생성 함수 사용
- Store 밖에서 상태 직접 변경
- SQL문 안에 변수 직접 삽입 (파라미터 바인딩 필수)
- `console.log` 프로덕션 잔류 — `tracing` 사용

## Project Structure & Boundaries

### Complete Project Directory Structure

```
flow-orche/
├── .github/
│   └── workflows/
│       └── ci.yml                    ← GitHub Actions (tauri-action)
├── .env.example                      ← 환경 변수 템플릿
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── prettier.config.js
├── components.json                   ← shadcn/ui 설정
│
├── src/                              ← 프론트엔드 (React 19 + TypeScript)
│   ├── app/
│   │   ├── App.tsx                   ← 앱 루트 (프로바이더, 에러 바운더리)
│   │   ├── routes.tsx                ← React Router 라우트 정의
│   │   └── providers.tsx             ← 전역 프로바이더 조합
│   │
│   ├── features/
│   │   ├── project/                  ← FR1~FR5 프로젝트 관리
│   │   │   ├── components/
│   │   │   │   ├── ProjectCard.tsx
│   │   │   │   ├── ProjectGrid.tsx
│   │   │   │   └── ProjectForm.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useProjects.ts
│   │   │   ├── stores/
│   │   │   │   └── projectStore.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── team/                     ← FR6~FR14 팀 실행/제어
│   │   │   ├── components/
│   │   │   │   ├── TeamPanel.tsx
│   │   │   │   ├── AgentCard.tsx
│   │   │   │   ├── LaunchProgress.tsx
│   │   │   │   └── StatusIndicator.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useTeamControl.ts
│   │   │   ├── stores/
│   │   │   │   └── teamStore.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── preset/                   ← FR15~FR18 프리셋 관리
│   │   │   ├── components/
│   │   │   │   ├── PresetList.tsx
│   │   │   │   └── PresetEditor.tsx
│   │   │   ├── stores/
│   │   │   │   └── presetStore.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── notification/             ← FR19~FR22 알림 (Phase 1b)
│   │   │   ├── components/
│   │   │   │   └── NotificationItem.tsx
│   │   │   ├── stores/
│   │   │   │   └── notificationStore.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── account/                  ← FR23~FR27 계정 관리 (Phase 1b)
│   │   │   ├── components/
│   │   │   │   └── AccountSwitcher.tsx
│   │   │   ├── stores/
│   │   │   │   └── accountStore.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── terminal/                 ← 터미널 뷰 (ghostty-web)
│   │   │   ├── components/
│   │   │   │   └── TerminalView.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useTerminal.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   └── environment/              ← FR28~FR30 환경/Onboarding
│   │       ├── components/
│   │       │   └── EnvironmentCheck.tsx
│   │       ├── hooks/
│   │       │   └── useSystemCheck.ts
│   │       ├── types.ts
│   │       └── index.ts
│   │
│   ├── components/                   ← 공유 UI
│   │   ├── ui/                       ← shadcn/ui 컴포넌트
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── command.tsx           ← Command Palette (cmdk)
│   │   │   └── ...
│   │   └── layout/
│   │       ├── Sidebar.tsx
│   │       ├── Header.tsx
│   │       └── PageLayout.tsx
│   │
│   ├── lib/
│   │   ├── event-bridge/             ← 중앙 이벤트 브릿지 (모듈 분리)
│   │   │   ├── index.ts              ← initEventBridge / destroyEventBridge
│   │   │   ├── team-events.ts
│   │   │   ├── process-events.ts
│   │   │   └── notification-events.ts
│   │   ├── tauri/                    ← tauri-specta 생성 타입/함수
│   │   │   ├── commands.ts           ← specta 자동 생성
│   │   │   └── events.ts             ← specta 이벤트 타입
│   │   └── utils.ts                  ← 공통 유틸리티
│   │
│   ├── stores/                       ← 전역 Zustand store
│   │   ├── appStore.ts               ← 앱 설정, UI 상태
│   │   └── networkStore.ts           ← 온라인/오프라인 상태
│   │
│   ├── styles/
│   │   └── globals.css               ← Tailwind v4 @theme, oklch 변수
│   │
│   └── main.tsx                      ← 앱 엔트리포인트
│
├── src-tauri/                        ← 백엔드 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json               ← Tauri 설정 (권한, 플러그인)
│   ├── capabilities/                 ← Tauri v2 권한 설정
│   │   └── default.json
│   ├── icons/
│   ├── src/
│   │   ├── main.rs                   ← Tauri 앱 초기화, 플러그인 등록
│   │   ├── lib.rs                    ← 모듈 등록, specta 라우터
│   │   ├── commands/                 ← Tauri Command
│   │   │   ├── mod.rs
│   │   │   ├── project.rs            ← 프로젝트 CRUD
│   │   │   ├── team.rs               ← 팀 실행/제어
│   │   │   ├── preset.rs             ← 프리셋 관리
│   │   │   ├── account.rs            ← 계정 관리 (Phase 1b)
│   │   │   └── environment.rs        ← 환경 체크
│   │   ├── models/                   ← 데이터 구조체
│   │   │   ├── mod.rs
│   │   │   ├── project.rs
│   │   │   ├── team.rs
│   │   │   ├── preset.rs
│   │   │   └── account.rs
│   │   ├── services/                 ← 비즈니스 로직
│   │   │   ├── mod.rs
│   │   │   ├── tmux.rs               ← tmux 세션 관리
│   │   │   ├── claude.rs             ← Claude CLI 통합
│   │   │   ├── state_machine.rs      ← TeamState enum + 전환 로직
│   │   │   └── hooks_watcher.rs      ← Claude hooks 파일 감시 (Phase 1b)
│   │   ├── db/
│   │   │   ├── mod.rs                ← DB 초기화, 커넥션 풀
│   │   │   └── migrations/
│   │   │       ├── 001_initial.sql   ← projects, team_sessions
│   │   │       └── 002_presets.sql   ← team_presets
│   │   └── errors.rs                 ← AppError (thiserror)
│   └── tests/                        ← Rust 통합 테스트
│       ├── tmux_integration.rs
│       └── db_migration.rs
```

### Architectural Boundaries

**IPC Boundaries (Rust ↔ React):**

```
React Component → specta 함수 호출 → Tauri IPC → Rust Command → Service → DB/Process
                                                        ↓
React Store ← event-bridge ← Tauri Event ← Rust emit()
```

- 프론트엔드는 `lib/tauri/commands.ts` (specta 생성)만 통해 백엔드 접근
- 백엔드는 `app.emit()` 만 통해 프론트엔드에 이벤트 전달
- 직접 `invoke()` 호출 금지

**Service Boundaries (Rust 내부):**

| 레이어 | 역할 | 접근 규칙 |
|--------|------|----------|
| `commands/` | IPC 진입점, 입력 검증 | services/ 호출만 |
| `services/` | 비즈니스 로직, 외부 프로세스 | db/, models/ 접근 |
| `db/` | 데이터 접근, 마이그레이션 | rusqlite 직접 접근 |
| `models/` | 데이터 구조체 정의 | 의존성 없음 (순수 struct) |
| `errors.rs` | 에러 타입 정의 | 모든 레이어에서 사용 |

- `commands/` → `services/` → `db/` 단방향 의존
- `models/`와 `errors.rs`는 모든 레이어에서 참조 가능

**Data Boundaries:**

| 데이터 | 저장소 | 접근 경로 |
|--------|--------|----------|
| 프로젝트, 프리셋, 세션 기록 | SQLite (`~/.flow-orche/data.db`) | `db/` 모듈 |
| 계정 토큰 | macOS Keychain | `services/` → Tauri Security API |
| UI 설정 (사이드바 너비 등) | Zustand persist (localStorage) | `stores/appStore.ts` |
| 프로세스 상태 (팀 실행 중) | 메모리 (Rust State) | `services/state_machine.rs` |

### Requirements to Structure Mapping

| FR 범위 | 도메인 | 프론트엔드 | 백엔드 | DB |
|---------|--------|-----------|--------|-----|
| FR1~FR5 | 프로젝트 관리 | `features/project/` | `commands/project.rs`, `services/` → `db/` | `001_initial.sql` |
| FR6~FR14 | 팀 실행/제어 | `features/team/`, `features/terminal/` | `commands/team.rs`, `services/tmux.rs`, `services/claude.rs`, `services/state_machine.rs` | `001_initial.sql` |
| FR15~FR18 | 프리셋 관리 | `features/preset/` | `commands/preset.rs` → `db/` | `002_presets.sql` |
| FR19~FR22 | 알림 | `features/notification/` | `services/hooks_watcher.rs` | — |
| FR23~FR27 | 계정 관리 | `features/account/` | `commands/account.rs` → Keychain | — |
| FR28~FR30 | 환경/Onboarding | `features/environment/` | `commands/environment.rs` | — |
| FR31~FR33 | 데이터/오프라인 | `stores/networkStore.ts` | `db/` | SQLite 전체 |

### Cross-Cutting Concerns Mapping

| 관심사 | 위치 |
|--------|------|
| 이벤트 동기화 | `lib/event-bridge/` → `stores/` |
| 에러 핸들링 | `errors.rs` (Rust), 에러 바운더리 (React `app/App.tsx`) |
| 로깅 | `tracing` (Rust 전역), Tauri Log Plugin |
| 권한 관리 | `src-tauri/capabilities/default.json` |
| 라우팅 | `app/routes.tsx` |

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
- Tauri v2 + rusqlite: 충돌 없음, Tauri Managed State로 커넥션 공유
- tauri-specta + Tauri v2: specta v2가 Tauri v2 지원
- Zustand + React Router: 독립적 관심사, 충돌 없음
- ghostty-web + Tauri 웹뷰: WASM 기반, 웹뷰 내 렌더링 호환
- thiserror + tauri-specta: specta가 에러 타입 직렬화 지원
- Shell Plugin + tracing: 프로세스 이벤트 + 로그 독립 동작

모순되는 결정 없음.

**Pattern Consistency:**
- DB `snake_case` ↔ JSON `camelCase` 변환: `serde(rename_all)` 처리 ✅
- Rust Command `snake_case` ↔ TS 함수 `camelCase`: specta 자동 변환 ✅
- 이벤트 `{도메인}:{동작}` ↔ 이벤트 브릿지 모듈 분리: 도메인별 파일 매칭 ✅
- feature 코로케이션 ↔ 배럴 export 규칙: 일관된 모듈 경계 ✅

**Structure Alignment:**
- 프로젝트 구조가 모든 아키텍처 결정 지원 ✅
- IPC / Service / Data 경계 명확히 정의 ✅
- feature 구조가 FR 도메인과 1:1 매핑 ✅

### Requirements Coverage Validation ✅

**Functional Requirements Coverage (33/33):**

| FR 범위 | 커버리지 | 아키텍처 지원 |
|---------|---------|-------------|
| FR1~FR5 프로젝트 관리 | ✅ | `features/project/` + `commands/project.rs` + SQLite |
| FR6~FR14 팀 실행/제어 | ✅ | `features/team/` + `services/tmux.rs` + `state_machine.rs` + Shell Plugin |
| FR15~FR18 프리셋 관리 | ✅ | `features/preset/` + `commands/preset.rs` + SQLite |
| FR19~FR22 알림 | ✅ | `features/notification/` + `services/hooks_watcher.rs` + 이벤트 브릿지 |
| FR23~FR27 계정 관리 | ✅ | `features/account/` + Keychain + `claude auth` 위임 |
| FR28~FR30 환경/Onboarding | ✅ | `features/environment/` + `commands/environment.rs` |
| FR31~FR33 데이터/오프라인 | ✅ | SQLite 로컬 + `networkStore.ts` |

**Non-Functional Requirements Coverage:**

| NFR | 커버리지 | 아키텍처 지원 |
|-----|---------|-------------|
| Cold start < 3초 | ✅ | Rust 네이티브 + SQLite 경량 + Vite 번들 최적화 |
| UI 논블로킹 | ✅ | Tauri Command 비동기 + Zustand 옵티미스틱 업데이트 |
| Keychain 토큰 저장 | ✅ | macOS Keychain + 최소 권한 원칙 |
| tmux 99% 안정성 | ✅ | 재시도 3회 + tracing 로깅 + 에러 복구 패턴 |
| 오프라인 CRUD | ✅ | SQLite 로컬, networkStore 감지 |

### Implementation Readiness Validation ✅

**Decision Completeness:**
- 모든 Critical 결정 문서화 + 버전 명시 ✅
- 구현 패턴 5개 카테고리 포괄적 정의 ✅
- Enforcement Guidelines + Anti-Patterns 명시 ✅

**Structure Completeness:**
- 전체 디렉토리 트리 정의 (파일 레벨) ✅
- 3개 경계 (IPC, Service, Data) 명확 정의 ✅
- FR → 파일 매핑 완료 ✅

**Pattern Completeness:**
- 네이밍 (DB, Rust, TS, 이벤트, JSON) 전체 정의 ✅
- 통신 (이벤트 시스템, Store 패턴) 정의 ✅
- 프로세스 (에러, 로딩, 재시도) 정의 ✅

### Gap Analysis Results

**보완 완료 (Important):**

1. **Tauri Managed State 패턴** — rusqlite 커넥션 + TeamState를 `app.manage()` 로 공유:

```rust
// main.rs — 앱 초기화 시 상태 등록
app.manage(DbConnection::new()?);           // rusqlite 커넥션
app.manage(Mutex::new(TeamStateMap::new())); // 팀 상태 맵

// command에서 접근
#[tauri::command]
fn get_project(db: State<DbConnection>, id: String) -> Result<Project, AppError> { ... }
```

2. **DB 파일 경로 관리** — `app.path().app_data_dir()` → `~/.flow-orche/data.db`, 앱 최초 실행 시 디렉토리 + DB 파일 + 마이그레이션 자동 실행

**Post-MVP (Nice-to-have):**
- E2E 테스트 전략 (Tauri driver 또는 Playwright)
- 성능 프로파일링 도구 (Tauri DevTools, React DevTools로 충분)

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context 분석 (33 FR, 7 도메인)
- [x] Scale & Complexity 평가 (Medium-High)
- [x] Technical Constraints 식별 (9개)
- [x] Cross-cutting concerns 매핑 (5개)
- [x] Technology Stack 검증 (Context7 MCP)

**✅ Architectural Decisions**
- [x] Data Architecture (rusqlite, 코드 우선, 임베디드 마이그레이션)
- [x] Authentication & Security (Keychain, CLI 위임, 최소 권한)
- [x] API & Communication (specta, thiserror, Shell Plugin, enum 상태 머신)
- [x] Frontend Architecture (React Router, feature 코로케이션, 이벤트 브릿지)
- [x] Infrastructure & Deployment (DMG, GitHub Actions, tracing)

**✅ Implementation Patterns**
- [x] Naming conventions (DB, Rust, TS, 이벤트, JSON)
- [x] Structure patterns (프론트엔드, 백엔드, 테스트)
- [x] Format patterns (응답, 에러, 날짜, 직렬화)
- [x] Communication patterns (이벤트 시스템, Zustand store)
- [x] Process patterns (에러 핸들링, 로딩 상태, 재시도)

**✅ Project Structure**
- [x] Complete directory tree (파일 레벨)
- [x] Architectural boundaries (IPC, Service, Data)
- [x] Requirements to structure mapping (FR → 파일)
- [x] Cross-cutting concerns mapping

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

**Key Strengths:**
- 33개 FR 전체 아키텍처 지원 확인
- Tauri v2 네이티브 기능 최대 활용 (Shell Plugin, Events, Managed State)
- 명확한 레이어 경계 (commands → services → db)
- AI 에이전트 간 충돌 방지 패턴 포괄적 정의
- 외부 프로세스(tmux, Claude CLI) 통합 전략 명확

**Areas for Future Enhancement:**
- E2E 테스트 전략 (Post-MVP)
- 자동 업데이트 (Phase 2, 코드 서명/공증 선행)
- Homebrew Cask 배포 (사용자 규모 확인 후)
- 성능 최적화 프로파일링 (필요 시)

### Implementation Handoff

**AI Agent Guidelines:**
- 이 문서의 모든 아키텍처 결정을 정확히 따를 것
- Implementation Patterns의 네이밍/구조/통신 규칙 일관 적용
- Project Structure의 경계를 존중하고 레이어 위반 금지
- 아키텍처 관련 질문은 이 문서를 참조

**First Implementation Priority:**

```bash
npm create tauri-app@latest flow-orche -- --template react-ts
cd flow-orche
npm install zustand react-router-dom
npx shadcn@latest init
# Rust: Cargo.toml에 rusqlite, thiserror, tracing, tauri-specta 추가
```
