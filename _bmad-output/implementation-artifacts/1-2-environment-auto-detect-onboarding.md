# Story 1.2: 환경 자동 감지 & Onboarding

Status: review

## Story

As a 첫 사용자,
I want 앱이 필수 의존성을 자동으로 확인하고 누락 시 설치 안내를 제공하길,
So that 수동으로 환경을 점검하지 않고도 앱 사용 준비를 완료할 수 있다.

## Acceptance Criteria

1. **Given** 사용자가 앱을 처음 실행할 때 **When** 환경 감지가 시작되면 **Then** Claude Code CLI 설치 여부, tmux 설치 여부, 인증 상태를 자동 감지하여 결과를 표시한다
2. **Given** tmux가 설치되지 않은 환경에서 **When** 환경 감지 결과가 표시되면 **Then** "brew install tmux" 설치 안내 메시지가 표시된다 **And** [재확인] 버튼이 제공되어 설치 후 다시 검증할 수 있다
3. **Given** 모든 의존성이 확인된 상태에서 **When** 환경 감지가 완료되면 **Then** "환경 준비 완료" 표시와 함께 프로젝트 등록으로 안내된다

## Tasks / Subtasks

- [x] Task 1: Rust 환경 감지 서비스 구현 (AC: #1)
  - [x] 1.1: `src-tauri/src/services/environment.rs` — `check_dependency_exists()` 함수 (which 래퍼)
  - [x] 1.2: `check_claude_cli()` — `claude --version` 실행, 버전 파싱
  - [x] 1.3: `check_tmux()` — `tmux -V` 실행, 버전 파싱
  - [x] 1.4: `check_claude_auth()` — `claude auth status` 실행, 인증 상태 파싱
  - [x] 1.5: `EnvironmentStatus` struct 정의 (models/environment.rs) — `#[serde(rename_all = "camelCase")]`

- [x] Task 2: Tauri Command 연결 (AC: #1, #2, #3)
  - [x] 2.1: `src-tauri/src/commands/environment.rs` — `check_environment` Tauri command
  - [x] 2.2: `src-tauri/src/commands/environment.rs` — `recheck_environment` Tauri command (재확인)
  - [x] 2.3: `lib.rs` — invoke_handler에 새 커맨드 등록
  - [x] 2.4: `src/lib/tauri/commands.ts` — `checkEnvironment()`, `recheckEnvironment()` 래퍼 추가

- [x] Task 3: 프론트엔드 EnvironmentCheck 컴포넌트 (AC: #1, #2, #3)
  - [x] 3.1: `src/features/environment/types.ts` — EnvironmentStatus, DependencyItem 타입 정의
  - [x] 3.2: `src/features/environment/hooks/useSystemCheck.ts` — 환경 감지 훅 (checkEnvironment 호출, 상태 관리)
  - [x] 3.3: `src/features/environment/components/EnvironmentCheck.tsx` — 감지 결과 UI
  - [x] 3.4: 각 의존성 항목: ✅ 설치됨(버전) / ❌ 미설치(설치 안내 링크)
  - [x] 3.5: [재확인] 버튼 — recheckEnvironment 호출, 로딩 상태 표시
  - [x] 3.6: 모두 통과 시 "환경 준비 완료" + "프로젝트 등록하기" CTA 버튼

- [x] Task 4: Onboarding 플로우 통합 (AC: #3)
  - [x] 4.1: `src/stores/appStore.ts` — `onboardingComplete: boolean` 상태 추가 (persist)
  - [x] 4.2: `src/app/routes.tsx` — 조건부 라우팅: onboarding 미완료 → EnvironmentCheck, 완료 → Dashboard
  - [x] 4.3: 환경 감지 완료 후 `onboardingComplete = true` 설정 → 대시보드로 리다이렉트

- [x] Task 5: 테스트 (AC: #1, #2, #3)
  - [x] 5.1: Rust 단위 테스트 — 5개 테스트 작성 (dependency 존재/미존재, 환경 상태 검증, 직렬화 2건)
  - [x] 5.2: 프론트엔드 빌드 확인 (tsc + vite build 성공)

## Dev Notes

### 아키텍처 패턴 & 제약사항

**CRITICAL — 반드시 따를 것:**

1. **외부 CLI 실행 패턴:**
   - `std::process::Command::new()` 사용 — Tauri Shell Plugin은 팀 실행용 (Story 3.x)
   - 모든 CLI 실행에 타임아웃 적용 (5초)
   - `Output` 결과의 stdout/stderr 파싱 — `unwrap()` 금지, `?` + `AppError` 전파
   - 에러 시 `AppError::Internal()` 반환, 사용자에게는 한국어 안내

2. **EnvironmentStatus 모델:**
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct EnvironmentStatus {
       pub claude_cli: DependencyStatus,
       pub tmux: DependencyStatus,
       pub claude_auth: DependencyStatus,
       pub all_ready: bool,
   }

   #[derive(Debug, Clone, Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct DependencyStatus {
       pub installed: bool,
       pub version: Option<String>,
       pub message: String,
       pub install_hint: Option<String>,
   }
   ```

3. **설치 안내 메시지:**
   | 의존성 | 미설치 안내 |
   |--------|-----------|
   | Claude Code CLI | "npm install -g @anthropic-ai/claude-code" |
   | tmux | "brew install tmux" |
   | Claude 인증 | "터미널에서 `claude auth login` 실행" |

4. **UX 패턴:**
   - 감지 진행 중: 각 항목에 스피너 표시
   - 완료: ✅(Emerald) 또는 ❌(Rose) 아이콘
   - [재확인] 버튼: Secondary 스타일 (Zinc-800)
   - "프로젝트 등록하기": Primary 스타일 (Indigo), `lg` 크기 (36px)

5. **Onboarding 상태 persist:**
   - `appStore.ts`의 persist 미들웨어로 localStorage에 저장
   - 앱 재실행 시 onboarding 완료 상태면 바로 대시보드

### Story 1.1 인텔리전스 (이전 스토리 학습)

- **패키지 매니저:** bun 사용 (npm 아님)
- **tauri-plugin-log 사용:** tracing_subscriber와 충돌하므로 tauri-plugin-log만 사용
- **테스트 패턴:** `tempfile::tempdir()` + `DbConnection::new()` + `expect()` (테스트에서만)
- **파일 위치:** architecture.md의 디렉토리 구조 정확히 준수
- **컴포넌트에서 invoke() 금지:** `lib/tauri/commands.ts` 래퍼 함수 사용

### Project Structure Notes

- `src/features/environment/` 디렉토리에 components/, hooks/, types.ts 생성
- `src-tauri/src/services/environment.rs` — 서비스 레이어에서 CLI 실행
- `src-tauri/src/commands/environment.rs` — Tauri Command 진입점
- `src-tauri/src/models/environment.rs` — EnvironmentStatus 구조체

### References

- [Source: architecture.md#Core Architectural Decisions] — 에러 핸들링, IPC 패턴
- [Source: architecture.md#Implementation Patterns] — 네이밍, 재시도 패턴
- [Source: epics.md#Story 1.2] — Acceptance Criteria 원문
- [Source: ux-design-specification.md] — EnvironmentCheck 컴포넌트 스펙
- [Source: prd.md#FR28~FR30] — 환경 의존성 감지, 설치 안내, 재확인

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- 미사용 import 경고: `std::time::Duration`, `crate::errors::AppError` → 제거 완료

### Completion Notes List

- Rust 환경 감지 서비스: `which` → 버전 체크 2단계 패턴 적용
- `check_claude_auth()`: `authenticated`, `logged in`, `active` 키워드로 인증 판별
- EnvironmentCheck 컴포넌트: 로딩 스피너, 설치/미설치 아이콘, install_hint 코드 블록
- Onboarding 플로우: `onboardingComplete` false → EnvironmentCheck, true → BrowserRouter+Dashboard
- 8개 Rust 테스트 모두 통과 (기존 3 + 신규 5)
- 프론트엔드 빌드 성공 (tsc + vite)

### Change Log

- NEW: `src-tauri/src/models/environment.rs` — DependencyStatus, EnvironmentStatus 모델
- NEW: `src-tauri/src/services/environment.rs` — check_claude_cli, check_tmux, check_claude_auth, check_environment
- NEW: `src-tauri/src/commands/environment.rs` — check_environment, recheck_environment Tauri commands
- MOD: `src-tauri/src/models/mod.rs` — environment 모듈 추가
- MOD: `src-tauri/src/services/mod.rs` — environment 모듈 추가
- MOD: `src-tauri/src/commands/mod.rs` — environment 모듈 추가
- MOD: `src-tauri/src/lib.rs` — invoke_handler에 2개 커맨드 등록
- MOD: `src/lib/tauri/commands.ts` — EnvironmentStatus 타입 + checkEnvironment/recheckEnvironment 래퍼
- NEW: `src/features/environment/types.ts` — 타입 re-export
- NEW: `src/features/environment/hooks/useSystemCheck.ts` — 환경 감지 훅
- NEW: `src/features/environment/components/EnvironmentCheck.tsx` — Onboarding UI
- MOD: `src/features/environment/index.ts` — barrel export 추가
- MOD: `src/stores/appStore.ts` — onboardingComplete + completeOnboarding 추가
- MOD: `src/app/routes.tsx` — Onboarding 조건부 라우팅

### File List

- `src-tauri/src/models/environment.rs`
- `src-tauri/src/services/environment.rs`
- `src-tauri/src/commands/environment.rs`
- `src-tauri/src/models/mod.rs`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`
- `src/lib/tauri/commands.ts`
- `src/features/environment/types.ts`
- `src/features/environment/hooks/useSystemCheck.ts`
- `src/features/environment/components/EnvironmentCheck.tsx`
- `src/features/environment/index.ts`
- `src/stores/appStore.ts`
- `src/app/routes.tsx`
