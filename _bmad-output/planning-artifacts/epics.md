---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
workflowComplete: true
inputDocuments:
  - prd.md
  - architecture.md
  - ux-design-specification.md
---

# flow-orche - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for flow-orche, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 사용자는 로컬 디렉토리 경로를 지정하여 새 프로젝트를 등록할 수 있다
FR2: 사용자는 등록된 프로젝트 목록을 카드 형태로 조회할 수 있다
FR3: 사용자는 프로젝트의 이름, 경로, 사용할 계정, 기본 프롬프트 등 설정을 편집할 수 있다
FR4: 사용자는 프로젝트를 삭제할 수 있다
FR5: 시스템은 각 프로젝트의 현재 상태(활성/비활성/에러)를 표시한다
FR6: 사용자는 프로젝트 카드에서 원클릭으로 에이전트 팀을 시작할 수 있다
FR7: 시스템은 팀 시작 시 tmux 세션을 자동 생성하고 프로젝트 디렉토리로 이동한다
FR8: 시스템은 tmux 세션에서 Claude Code를 Agent Teams 모드로 자동 실행한다
FR9: 시스템은 Claude Code 프롬프트 준비 상태를 감지한 후 팀 프리셋 프롬프트를 자동 전송한다
FR10: 사용자는 실행 중인 프로젝트의 에이전트 팀을 중지할 수 있다
FR11: 시스템은 팀 중지 시 관련 tmux 세션을 정리한다
FR12: 사용자는 여러 프로젝트의 에이전트 팀을 동시에 실행할 수 있다
FR13: 시스템은 팀 스폰 실패(타임아웃, Claude Code 응답 없음)를 감지하고 사용자에게 알린다
FR14: 사용자는 팀 스폰 실패 시 재시도할 수 있다
FR15: 사용자는 프로젝트별 팀 프리셋을 생성할 수 있다 (역할 구성: SM, Dev, QA 등, 각 역할의 수)
FR16: 사용자는 팀 프리셋의 각 역할별 프롬프트를 커스터마이즈할 수 있다
FR17: 시스템은 기본 팀 프리셋(SM+Dev+QA)을 제공한다
FR18: 사용자는 프리셋을 편집하고 삭제할 수 있다
FR19: 시스템은 각 프로젝트의 Claude hooks 이벤트(작업 완료, 사용자 입력 대기, 에러)를 수신한다
FR20: 시스템은 알림을 프로젝트별로 구분하여 앱 내 알림 패널에 표시한다
FR21: 시스템은 주요 이벤트 발생 시 macOS 네이티브 알림을 표시한다
FR22: 사용자는 알림 히스토리를 프로젝트별로 조회할 수 있다
FR23: 사용자는 여러 Claude Max 계정 프로필을 등록할 수 있다
FR24: 사용자는 각 계정 프로필에 이름을 부여할 수 있다
FR25: 사용자는 앱 내에서 원클릭으로 활성 계정을 전환할 수 있다
FR26: 시스템은 계정 전환 시 프로젝트 데이터와 프리셋을 독립적으로 보장한다
FR27: 시스템은 실행 중인 팀이 있을 때 계정 전환을 경고한다
FR28: 시스템은 첫 실행 시 필수 의존성(Claude Code CLI, tmux, 인증 상태)을 자동 감지한다
FR29: 시스템은 누락된 의존성에 대해 설치 안내 메시지를 표시한다
FR30: 사용자는 의존성 설치 후 재확인을 요청할 수 있다
FR31: 시스템은 모든 프로젝트/프리셋/계정 데이터를 로컬(SQLite)에 저장한다
FR32: 사용자는 네트워크 없이도 프로젝트 관리, 프리셋 편집, 설정 변경을 할 수 있다
FR33: 시스템은 네트워크 미연결 시 Claude Code 의존 기능만 비활성화 상태로 표시한다
FR34: 사용자는 Cmd+K 커맨드 팔레트로 프로젝트 검색, 빠른 액션 실행, 설정 접근을 할 수 있다

### NonFunctional Requirements

NFR1: 앱 Cold Start → 대시보드 표시 < 3초 (Tauri 앱 실행 ~ 첫 화면 렌더)
NFR2: 프로젝트 카드 클릭 → tmux 세션 생성 < 2초
NFR3: Claude Code 실행 → 프롬프트 준비 감지 < 10초 (폴링 주기 500ms)
NFR4: 팀 프리셋 프롬프트 전송 < 5초
NFR5: 전체 런치 (클릭 → 팀 가동) < 20초
NFR6: UI 반응성 — 논블로킹 (런치/중지 중에도 다른 프로젝트 카드 조작 가능)
NFR7: 프로젝트 목록 로드 < 500ms (SQLite 쿼리 ~ 카드 렌더 완료)
NFR8: 프롬프트 준비 감지 타임아웃 30초 (초과 시 실패 알림 + 재시도 옵션)
NFR9: 계정 인증 토큰은 macOS Keychain을 통해 안전하게 저장 (평문 저장 금지)
NFR10: SQLite DB 파일은 앱 전용 디렉토리에 저장, 민감하지 않은 데이터만 포함
NFR11: OAuth 인증은 Claude Code CLI(claude auth)에 위임, 앱이 직접 자격 증명 처리하지 않음
NFR12: tmux CLI 세션 생성/제어 명령 성공률 99%, 실패 시 재시도 1회 후 에러 표시
NFR13: Claude Code CLI 실행 및 프롬프트 감지 성공률 90%+, 타임아웃 30초 후 실패 알림
NFR14: Claude Code Hooks 이벤트 수신 지연 < 5초, 실패 시 tmux 출력 감시 fallback
NFR15: macOS Notification Center 알림 전달률 100%, 실패 시 앱 내 알림만 표시
NFR16: 파일 시스템 프로젝트 디렉토리 접근 가능 확인, 디렉토리 없거나 권한 없을 시 에러 표시

### Additional Requirements

**아키텍처 요구사항:**

- 스타터 템플릿: Official create-tauri-app + 수동 구성 (`npm create tauri-app@latest flow-orche -- --template react-ts`)
- 데이터 레이어: rusqlite 직접 사용 + 임베디드 SQL 마이그레이션 (`include_str!`)
- IPC 타입 안전성: tauri-specta로 Rust command → TypeScript 타입 자동 생성
- 프로세스 관리: Tauri Shell Plugin `spawn` + Rust enum 수동 상태 머신 (TeamState)
- 이벤트 동기화: 중앙 이벤트 브릿지 (`lib/event-bridge/`) + Zustand store 연결
- 프론트엔드 라우팅: React Router
- 코드 조직: feature 기반 코로케이션 (bulletproof-react 패턴)
- 에러 처리: thiserror 통합 에러 enum (AppError)
- 보안: macOS Keychain + `claude auth` CLI 위임
- 로깅: Tauri Log Plugin + Rust `tracing`
- 상태 관리: Zustand (persist, subscribeWithSelector, devtools)
- 빌드/배포: DMG + GitHub Actions (tauri-action)
- JSON 직렬화: `#[serde(rename_all = "camelCase")]` — Rust snake_case → JSON camelCase
- Tauri 이벤트 네이밍: `{도메인}:{동작-과거형}`, Payload에 `projectId` + `timestamp` 필수
- DB 파일 경로: `app.path().app_data_dir()` → `~/.flow-orche/data.db`
- Tauri Managed State로 DB 커넥션 + TeamStateMap 공유
- 구현 순서: rusqlite → tauri-specta → Shell Plugin/상태 머신 → 이벤트 브릿지 → React Router → 에러/로깅 → CI/CD → Keychain(Phase 1b)

**UX 요구사항:**

- 터미널 통합: ghostty-web (WASM) 기반 터미널 임베딩 (MVP 범위, 읽기 전용)
- 네비게이션: 3-Level Drill-Down (Dashboard Grid → Focus Mode → Agent Terminal)
- 커맨드 팔레트: Cmd+K (cmdk 기반) — 프로젝트 검색, 빠른 액션, 설정 접근
- 다크 테마 기본: Tailwind CSS v4 @theme + shadcn/ui + oklch 컬러
- 옵티미스틱 UI: 클릭 즉시 UI 상태 변경, 실패 시 롤백
- Launch Animation: 첫 팀 실행 전용 인상적 런치 시퀀스 (~3s)
- 프로젝트 컬러 코딩: 8색 팔레트로 프로젝트별 식별 (4px 좌측 바)
- 상태 컬러 시스템: Running(Emerald), Launching(Amber), Idle(Zinc), Stuck(Amber), Error(Rose)
- 컴포넌트: ProjectCard, StatusIndicator, LaunchProgress, AgentCard, TerminalView, CommandPalette, NotificationItem, AccountSwitcher, TeamPresetEditor, EnvironmentCheck
- 접근성: WCAG 2.1 AA 준수, 키보드 네비게이션, VoiceOver 지원, prefers-reduced-motion
- 윈도우 반응형: 최소 900x600, 권장 1280x800, 사이드바 240px 고정
- 버튼 위계: Primary(Indigo), Secondary(Zinc-800), Ghost(투명), Destructive(Rose)
- 확인 대화상자 금지: 즉시 실행 + 5초 Undo 토스트
- 에러 메시지: "보고" 톤 — 원인 + 복구 옵션 동시 제시
- 애니메이션: 200ms 기본, ease-out 커브, prefers-reduced-motion 대체 경로

### FR Coverage Map

FR1: Epic 1 — 프로젝트 등록
FR2: Epic 1 — 프로젝트 목록 카드 조회
FR3: Epic 1 — 프로젝트 설정 편집
FR4: Epic 1 — 프로젝트 삭제
FR5: Epic 1 — 프로젝트 상태 표시
FR6: Epic 3 — 원클릭 팀 시작
FR7: Epic 3 — tmux 세션 자동 생성
FR8: Epic 3 — Claude Code Agent Teams 모드 실행
FR9: Epic 3 — 프롬프트 준비 감지 + 프리셋 전송
FR10: Epic 3 — 팀 중지
FR11: Epic 3 — tmux 세션 정리
FR12: Epic 3 — 다중 프로젝트 동시 실행
FR13: Epic 3 — 스폰 실패 감지 + 알림
FR14: Epic 3 — 실패 시 재시도
FR15: Epic 2 — 팀 프리셋 생성
FR16: Epic 2 — 역할별 프롬프트 커스터마이즈
FR17: Epic 2 — 기본 프리셋 제공
FR18: Epic 2 — 프리셋 편집/삭제
FR19: Epic 4 — hooks 이벤트 수신
FR20: Epic 4 — 프로젝트별 앱 내 알림
FR21: Epic 4 — macOS 네이티브 알림
FR22: Epic 4 — 알림 히스토리 조회
FR23: Epic 5 — 계정 프로필 등록
FR24: Epic 5 — 계정 이름 부여
FR25: Epic 5 — 원클릭 계정 전환
FR26: Epic 5 — 계정 전환 시 데이터 독립
FR27: Epic 5 — 실행 중 팀 계정 전환 경고
FR28: Epic 1 — 환경 의존성 자동 감지
FR29: Epic 1 — 누락 의존성 설치 안내
FR30: Epic 1 — 의존성 재확인 요청
FR31: Epic 1 — SQLite 로컬 데이터 저장
FR32: Epic 1 — 오프라인 CRUD
FR33: Epic 1 — 네트워크 미연결 시 기능 비활성화
FR34: Epic 1 — Cmd+K 커맨드 팔레트

**커버리지: 34/34 FR — 100%**

## Epic List

### Epic 1: 프로젝트 기반 & 대시보드
앱을 설치하면 환경이 자동 확인되고, 프로젝트를 등록하여 카드 대시보드에서 관리할 수 있다.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR28, FR29, FR30, FR31, FR32, FR33, FR34

### Epic 2: 팀 프리셋 관리
팀 구성(SM+Dev+QA)을 프리셋으로 저장하고, 역할별 프롬프트를 커스터마이즈하여 재사용할 수 있다.
**FRs covered:** FR15, FR16, FR17, FR18

### Epic 3: 원클릭 팀 실행 & 제어
프로젝트 카드에서 한 번 클릭으로 에이전트 팀을 자동 시작하고, 진행 상태를 실시간 확인하며, 중지/재시도할 수 있다.
**FRs covered:** FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14

### Epic 4: 프로젝트별 알림 시스템 (Phase 1b)
각 프로젝트의 이벤트를 실시간 알림으로 받고, 프로젝트별 히스토리를 확인할 수 있다.
**FRs covered:** FR19, FR20, FR21, FR22

### Epic 5: 다중 계정 관리 (Phase 1b)
여러 Claude Max 계정을 등록하고 원클릭 전환하며, 프로젝트 데이터를 독립적으로 유지할 수 있다.
**FRs covered:** FR23, FR24, FR25, FR26, FR27

## Epic 1: 프로젝트 기반 & 대시보드

앱을 설치하면 환경이 자동 확인되고, 프로젝트를 등록하여 카드 대시보드에서 관리할 수 있다.

### Story 1.1: Tauri 앱 초기화 & 기본 앱 셸

As a 개발자(사용자),
I want flow-orche 앱을 실행하면 다크 테마 기본 인터페이스가 표시되길,
So that 앱이 제대로 설치되어 사용할 준비가 되었음을 확인할 수 있다.

**Acceptance Criteria:**

**Given** 사용자가 flow-orche 앱을 최초 실행할 때
**When** 앱이 시작되면
**Then** 3초 이내에 다크 테마 기본 레이아웃(사이드바 + 메인 콘텐츠 + 상태바)이 표시된다
**And** SQLite DB가 `~/.flow-orche/data.db`에 자동 생성되고 projects 테이블이 마이그레이션된다
**And** 사이드바(240px)와 메인 영역이 올바르게 배치된다
**And** 윈도우 최소 크기 900x600이 적용된다

### Story 1.2: 환경 자동 감지 & Onboarding

As a 첫 사용자,
I want 앱이 필수 의존성을 자동으로 확인하고 누락 시 설치 안내를 제공하길,
So that 수동으로 환경을 점검하지 않고도 앱 사용 준비를 완료할 수 있다.

**Acceptance Criteria:**

**Given** 사용자가 앱을 처음 실행할 때
**When** 환경 감지가 시작되면
**Then** Claude Code CLI 설치 여부, tmux 설치 여부, 인증 상태를 자동 감지하여 결과를 표시한다

**Given** tmux가 설치되지 않은 환경에서
**When** 환경 감지 결과가 표시되면
**Then** "brew install tmux" 설치 안내 메시지가 표시된다
**And** [재확인] 버튼이 제공되어 설치 후 다시 검증할 수 있다

**Given** 모든 의존성이 확인된 상태에서
**When** 환경 감지가 완료되면
**Then** "환경 준비 완료" 표시와 함께 프로젝트 등록으로 안내된다

### Story 1.3: 프로젝트 등록 & 카드 대시보드

As a 사용자,
I want 로컬 프로젝트를 등록하고 카드 대시보드에서 모든 프로젝트를 한눈에 볼 수 있길,
So that 여러 프로젝트를 시각적으로 관리할 수 있다.

**Acceptance Criteria:**

**Given** 사용자가 대시보드에서 프로젝트 등록을 시작할 때
**When** 디렉토리를 선택하고 프로젝트 이름을 입력하면
**Then** 프로젝트가 SQLite에 저장되고 대시보드에 카드로 즉시 표시된다

**Given** 등록된 프로젝트가 3개 이상 있을 때
**When** 대시보드를 조회하면
**Then** 500ms 이내에 모든 프로젝트가 카드 그리드(2~3열)로 표시된다
**And** 각 카드에 프로젝트명, 경로, 상태(활성/비활성/에러), 프로젝트 컬러 바(4px 좌측)가 표시된다

**Given** 프로젝트 디렉토리가 존재하지 않을 때
**When** 대시보드에 프로젝트 상태가 표시되면
**Then** 해당 프로젝트 카드에 에러 상태(Rose)가 표시된다

**Given** 사이드바가 표시될 때
**When** 프로젝트 목록을 확인하면
**Then** 각 프로젝트가 컬러 도트 + 이름 + 상태 인디케이터로 표시된다

### Story 1.4: 프로젝트 편집, 삭제 & 오프라인 관리

As a 사용자,
I want 프로젝트 설정을 편집하고 삭제할 수 있으며 오프라인에서도 관리가 가능하길,
So that 상황에 맞게 프로젝트를 유연하게 관리할 수 있다.

**Acceptance Criteria:**

**Given** 등록된 프로젝트가 있을 때
**When** 프로젝트 설정 편집을 시작하면
**Then** 이름, 경로, 사용 계정, 기본 프롬프트를 인라인으로 수정할 수 있다
**And** 변경사항이 즉시 저장된다

**Given** 사용자가 프로젝트를 삭제할 때
**When** 삭제 버튼을 클릭하면
**Then** 프로젝트가 즉시 삭제되고 5초간 Undo 토스트가 화면 하단에 표시된다
**And** Undo 클릭 시 프로젝트가 복원된다

**Given** 네트워크가 연결되지 않은 상태에서
**When** 프로젝트 관리 기능을 사용하면
**Then** 프로젝트 등록/편집/삭제/조회가 정상 동작한다
**And** Claude Code 의존 기능(팀 시작 등)은 비활성화 상태로 표시된다

### Story 1.5: Cmd+K 커맨드 팔레트 & 키보드 네비게이션

As a 파워유저,
I want Cmd+K로 프로젝트를 빠르게 검색하고 키보드로 모든 핵심 액션을 실행하길,
So that 마우스 없이도 효율적으로 앱을 조작할 수 있다.

**Acceptance Criteria:**

**Given** 앱 어디에서든
**When** Cmd+K를 누르면
**Then** 커맨드 팔레트가 오버레이로 표시되고 퍼지 검색이 즉시 동작한다
**And** 결과가 "프로젝트 > 액션 > 설정" 카테고리로 분류된다
**And** 각 항목에 현재 상태 배지가 표시된다

**Given** 커맨드 팔레트에서 프로젝트를 선택할 때
**When** Enter를 누르면
**Then** 해당 프로젝트의 상세 뷰로 이동한다

**Given** 앱 어디에서든
**When** Cmd+1을 누르면 대시보드로, Cmd+N을 누르면 새 프로젝트 등록으로, ESC를 누르면 이전으로 이동한다

## Epic 2: 팀 프리셋 관리

팀 구성(SM+Dev+QA)을 프리셋으로 저장하고, 역할별 프롬프트를 커스터마이즈하여 재사용할 수 있다.

### Story 2.1: 기본 프리셋 제공 & 프리셋 생성

As a 사용자,
I want 기본 팀 프리셋이 즉시 제공되고 커스텀 프리셋을 생성할 수 있길,
So that 프로젝트에 맞는 팀 구성을 빠르게 준비할 수 있다.

**Acceptance Criteria:**

**Given** 프로젝트가 등록된 상태에서
**When** 프리셋 관리를 처음 열면
**Then** 기본 프리셋(SM 1명 + Dev 1명 + QA 1명)이 이미 제공되어 있다

**Given** 사용자가 새 프리셋을 생성할 때
**When** 역할(SM/Dev/QA)과 각 역할의 인원 수를 지정하면
**Then** 프리셋이 프로젝트에 연결되어 SQLite(team_presets 테이블)에 저장된다
**And** team_presets, preset_roles 테이블이 존재하지 않으면 마이그레이션으로 자동 생성된다
**And** Dev를 2명 이상으로 설정할 수 있다 (예: SM 1 + Dev 3 + QA 1)

### Story 2.2: 역할별 프롬프트 커스터마이즈

As a 사용자,
I want 각 역할(SM/Dev/QA)의 프롬프트를 직접 작성할 수 있길,
So that 프로젝트 특성에 맞는 팀 지시 사항을 세밀하게 설정할 수 있다.

**Acceptance Criteria:**

**Given** 프리셋이 생성된 상태에서
**When** 특정 역할의 프롬프트를 편집하면
**Then** 텍스트 입력 영역에서 역할별 프롬프트를 자유롭게 작성할 수 있다
**And** 변경사항이 즉시 저장된다

**Given** 기본 프리셋의 프롬프트가 비어 있을 때
**When** 프롬프트를 확인하면
**Then** 각 역할에 맞는 기본 프롬프트 템플릿이 힌트로 표시된다 (필수 입력은 아님)

### Story 2.3: 프리셋 편집 & 삭제

As a 사용자,
I want 기존 프리셋의 역할 구성을 변경하거나 불필요한 프리셋을 삭제할 수 있길,
So that 프리셋을 항상 최신 상태로 유지할 수 있다.

**Acceptance Criteria:**

**Given** 프리셋이 존재할 때
**When** 역할 인원 수를 +/- 카운터로 조정하면
**Then** 변경사항이 인라인으로 즉시 반영되고 저장된다

**Given** 사용자가 프리셋을 삭제할 때
**When** 삭제를 실행하면
**Then** 프리셋이 삭제되고 5초간 Undo 토스트가 표시된다
**And** 기본 프리셋은 삭제할 수 없다 (삭제 버튼 비활성)

**Given** 프로젝트에 프리셋이 하나만 남았을 때
**When** 삭제를 시도하면
**Then** "최소 1개 프리셋이 필요합니다" 안내가 표시된다

## Epic 3: 원클릭 팀 실행 & 제어

프로젝트 카드에서 한 번 클릭으로 에이전트 팀을 자동 시작하고, 진행 상태를 실시간 확인하며, 중지/재시도할 수 있다.

### Story 3.1: tmux 세션 생성 & 원클릭 팀 시작 기반

As a 사용자,
I want 프로젝트 카드에서 시작 버튼을 누르면 tmux 세션이 자동 생성되고 Claude Code가 실행되길,
So that 수동으로 터미널을 열고 디렉토리를 이동하는 반복 작업을 하지 않아도 된다.

**Acceptance Criteria:**

**Given** 프로젝트와 프리셋이 준비된 상태에서
**When** 프로젝트 카드의 [시작] 버튼을 클릭하면
**Then** 카드 상태가 즉시 "시작 중..."(Amber)으로 전환된다 (옵티미스틱 UI)
**And** 2초 이내에 프로젝트 전용 tmux 세션이 생성되고 프로젝트 디렉토리로 이동한다
**And** tmux 세션에서 Claude Code가 Agent Teams 모드(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)로 자동 실행된다

**Given** tmux 세션 생성이 실패할 때
**When** 에러가 발생하면
**Then** 카드 상태가 "실패"(Rose)로 전환되고 에러 원인이 표시된다
**And** 재시도 1회가 자동으로 수행된 후에도 실패 시 사용자에게 알린다

### Story 3.2: 프롬프트 준비 감지 & 팀 프리셋 자동 전송

As a 사용자,
I want Claude Code가 준비되면 팀 프리셋 프롬프트가 자동으로 전송되길,
So that 프롬프트를 수동으로 타이핑하지 않아도 팀이 자동 구성된다.

**Acceptance Criteria:**

**Given** Claude Code가 실행된 상태에서
**When** 프롬프트 준비 상태를 폴링(500ms 주기)으로 감지하면
**Then** 10초 이내에 준비 상태가 감지된다
**And** 감지 즉시 프리셋에 저장된 팀 프롬프트가 `tmux send-keys`로 자동 전송된다

**Given** 팀 프롬프트가 전송된 후
**When** 팀 스폰이 시작되면
**Then** 카드 상태가 "실행 중"(Emerald)으로 전환된다
**And** 전체 런치 시간(클릭→팀 가동)이 20초 이내에 완료된다

**Given** LaunchProgress가 표시될 때
**When** 각 단계(tmux 생성 → Claude 실행 → 프롬프트 감지 → 프리셋 전송 → 팀 스폰)가 진행되면
**Then** 완료된 단계는 ✅, 진행 중은 ⏳, 대기 중은 ○로 실시간 표시된다

### Story 3.3: 팀 중지 & tmux 세션 정리

As a 사용자,
I want 실행 중인 에이전트 팀을 중지하면 관련 리소스가 깔끔하게 정리되길,
So that 시스템 리소스가 낭비되지 않고 필요 시 다시 시작할 수 있다.

**Acceptance Criteria:**

**Given** 프로젝트 팀이 실행 중일 때
**When** [중지] 버튼을 클릭하면
**Then** 카드 상태가 즉시 "비활성"(Zinc)으로 전환된다
**And** 관련 tmux 세션이 종료되고 정리된다
**And** 5초간 Undo 토스트("팀 중지됨 — [되돌리기]")가 표시된다

**Given** 팀이 중지된 후
**When** [시작] 버튼을 다시 클릭하면
**Then** 동일한 프리셋으로 팀이 재구성된다

### Story 3.4: 다중 프로젝트 동시 실행

As a 사용자,
I want 여러 프로젝트의 에이전트 팀을 동시에 실행하고 각각 독립적으로 제어하길,
So that 멀티 프로젝트 워크플로우를 병렬로 운영할 수 있다.

**Acceptance Criteria:**

**Given** 프로젝트 A의 팀이 스폰 중일 때
**When** 프로젝트 B의 [시작] 버튼을 클릭하면
**Then** UI가 차단되지 않고 프로젝트 B의 팀 스폰이 독립적으로 시작된다
**And** 대시보드에서 두 프로젝트의 진행 상태가 각각 실시간으로 표시된다

**Given** 5개 프로젝트가 동시에 실행 중일 때
**When** 대시보드를 확인하면
**Then** 각 프로젝트의 상태(실행 중/시작 중/에러)가 카드 컬러로 즉시 구분된다
**And** 특정 프로젝트를 중지해도 다른 프로젝트에 영향이 없다

### Story 3.5: 스폰 실패 감지, 에러 안내 & 재시도

As a 사용자,
I want 팀 스폰 실패 시 어느 단계에서 왜 실패했는지 즉시 파악하고 재시도할 수 있길,
So that 문제를 빠르게 해결하고 작업을 이어갈 수 있다.

**Acceptance Criteria:**

**Given** 프롬프트 준비 감지가 30초를 초과할 때
**When** 타임아웃이 발생하면
**Then** 카드 상태가 "실패"(Rose)로 전환되고 "Claude Code 응답 없음 (30초 타임아웃)" 메시지가 표시된다
**And** [재시도] 버튼과 [상세 보기] 버튼이 인라인으로 제공된다

**Given** 사용자가 [재시도]를 클릭할 때
**When** 재시도가 시작되면
**Then** 동일한 설정으로 팀 스폰이 처음부터 다시 시작된다
**And** LaunchProgress가 리셋되어 처음 단계부터 다시 표시된다

**Given** 팀 스폰 중 tmux 세션이 비정상 종료될 때
**When** 실패가 감지되면
**Then** 실패한 단계가 ❌로 표시되고 구체적 에러 메시지가 카드에 표시된다
**And** 최대 3회까지 자동 재시도가 수행되고, 모두 실패 시 사용자에게 수동 옵션을 안내한다

### Story 3.6: Focus Mode — 에이전트 팀 상세 뷰

As a 사용자,
I want 프로젝트를 선택하면 에이전트 팀의 상세 상태를 확인할 수 있길,
So that 어떤 에이전트가 무엇을 하고 있는지 한눈에 파악할 수 있다.

**Acceptance Criteria:**

**Given** 실행 중인 프로젝트 카드를 클릭할 때
**When** Focus Mode (Level 2)로 진입하면
**Then** SM, Dev, QA 각 에이전트의 카드가 표시된다 (역할별 액센트 컬러)
**And** 각 AgentCard에 현재 상태와 StatusIndicator가 표시된다
**And** ESC 또는 뒤로 가기로 대시보드(Level 1)로 즉시 복귀한다

**Given** Focus Mode에서 에이전트 카드를 확인할 때
**When** 에이전트 목록이 표시되면
**Then** 각 에이전트의 역할, 현재 작업 상태, 마지막 활동 시간이 표시된다

### Story 3.7: Agent Terminal — ghostty-web 실시간 뷰

As a 사용자,
I want 개별 에이전트의 터미널 출력을 실시간으로 볼 수 있길,
So that 에이전트가 실제로 무엇을 하고 있는지 직접 확인하고 필요 시 개입할 수 있다.

**Acceptance Criteria:**

**Given** Focus Mode에서 에이전트 카드의 [터미널 보기]를 클릭할 때
**When** Agent Terminal (Level 3)로 진입하면
**Then** ghostty-web 기반 터미널에 해당 에이전트의 Claude Code 출력이 실시간으로 표시된다
**And** 터미널은 읽기 전용 뷰로 동작한다 (MVP)
**And** ESC로 Focus Mode(Level 2)로 복귀한다

**Given** 터미널 뷰가 표시될 때
**When** 에이전트의 Claude Code 출력이 업데이트되면
**Then** 새 출력이 자동 스크롤로 실시간 표시된다

## Epic 4: 프로젝트별 알림 시스템 (Phase 1b)

각 프로젝트의 이벤트를 실시간 알림으로 받고, 프로젝트별 히스토리를 확인할 수 있다.

### Story 4.1: Claude Hooks 이벤트 수신 & 앱 내 알림

As a 사용자,
I want 프로젝트에서 발생하는 이벤트(작업 완료, 입력 대기, 에러)를 앱 내에서 실시간으로 확인하길,
So that 각 프로젝트 상태 변화를 놓치지 않고 즉시 대응할 수 있다.

**Acceptance Criteria:**

**Given** Epic 4의 기능이 처음 사용될 때
**When** notifications 테이블이 존재하지 않으면
**Then** 마이그레이션으로 notifications 테이블이 자동 생성된다

**Given** 프로젝트 팀이 실행 중일 때
**When** Claude hooks 이벤트(작업 완료, 사용자 입력 대기, 에러)가 발생하면
**Then** 5초 이내에 이벤트가 수신되어 앱 내 알림 패널에 표시된다
**And** 알림에 프로젝트 컬러 도트가 표시되어 어떤 프로젝트의 알림인지 즉시 식별된다

**Given** 알림 패널을 열었을 때
**When** 여러 프로젝트의 알림이 쌓여 있으면
**Then** 프로젝트별로 필터링할 수 있다
**And** 각 알림에 이벤트 유형(info/success/warning/error), 메시지, 발생 시간이 표시된다

**Given** hooks 파일시스템 감시가 실패할 때
**When** fallback이 트리거되면
**Then** tmux 출력 감시로 자동 전환되어 이벤트 수신이 지속된다

### Story 4.2: macOS 네이티브 알림

As a 사용자,
I want 주요 이벤트 발생 시 macOS 알림 센터에 네이티브 알림이 뜨길,
So that 앱을 보지 않아도 중요한 상태 변화를 즉시 인지할 수 있다.

**Acceptance Criteria:**

**Given** 프로젝트 팀에서 주요 이벤트가 발생할 때
**When** macOS 알림이 전송되면
**Then** 알림 제목에 프로젝트명이 포함된다 (예: "flow-orche: 스토리 완료, QA 대기 중")
**And** 알림 클릭 시 해당 프로젝트의 Focus Mode로 이동한다

**Given** macOS 알림 권한이 거부된 상태에서
**When** 이벤트가 발생하면
**Then** 앱 내 알림 패널에만 표시되고 네이티브 알림은 건너뛴다

**Given** 여러 프로젝트에서 동시에 이벤트가 발생할 때
**When** 알림이 연속으로 전달되면
**Then** 각 알림에서 프로젝트를 명확히 구분할 수 있다

### Story 4.3: 알림 히스토리 조회

As a 사용자,
I want 지나간 알림을 프로젝트별로 조회할 수 있길,
So that 부재 중 어떤 일이 있었는지 파악하고 필요한 조치를 취할 수 있다.

**Acceptance Criteria:**

**Given** 알림이 쌓여 있을 때
**When** Notification Center(사이드 패널)를 열면
**Then** 최신 알림이 상단에 표시되고 스크롤로 과거 알림을 탐색할 수 있다

**Given** 특정 프로젝트의 알림만 보고 싶을 때
**When** 프로젝트 필터를 선택하면
**Then** 해당 프로젝트의 알림만 표시된다

**Given** 알림 항목에서 [이동] 버튼을 클릭할 때
**When** 해당 프로젝트의 Focus Mode로 이동하면
**Then** 해당 이벤트와 관련된 에이전트 상태를 즉시 확인할 수 있다

**Given** 알림을 [확인]할 때
**When** 확인 처리를 하면
**Then** 알림이 읽음 처리되고 시각적으로 구분된다 (미읽음: 밝은 배경, 읽음: 기본 배경)

## Epic 5: 다중 계정 관리 (Phase 1b)

여러 Claude Max 계정을 등록하고 원클릭 전환하며, 프로젝트 데이터를 독립적으로 유지할 수 있다.

### Story 5.1: 계정 프로필 등록 & 관리

As a 사용자,
I want 여러 Claude Max 계정을 프로필로 등록하고 이름을 붙여 관리하길,
So that 보유한 계정들을 체계적으로 구분하여 사용할 수 있다.

**Acceptance Criteria:**

**Given** Epic 5의 기능이 처음 사용될 때
**When** accounts 테이블이 존재하지 않으면
**Then** 마이그레이션으로 accounts 테이블이 자동 생성된다

**Given** 사용자가 계정을 등록할 때
**When** 계정 프로필 추가를 시작하면
**Then** 계정 이름을 입력하고 `claude auth` CLI를 통해 인증을 수행할 수 있다
**And** 인증 토큰이 macOS Keychain에 안전하게 저장된다 (평문 저장 금지)

**Given** 여러 계정이 등록된 상태에서
**When** 계정 목록을 확인하면
**Then** 각 계정이 사용자가 부여한 이름으로 표시된다 (예: "계정A — Max*20", "계정B — Max*20")

**Given** 계정 프로필을 편집할 때
**When** 이름을 수정하면
**Then** 변경사항이 즉시 저장된다

### Story 5.2: 원클릭 계정 전환 & 데이터 독립

As a 사용자,
I want 앱 내에서 원클릭으로 계정을 전환해도 프로젝트 데이터가 완벽히 유지되길,
So that 토큰 소진 시 작업 흐름을 끊지 않고 다른 계정으로 즉시 전환할 수 있다.

**Acceptance Criteria:**

**Given** 상태바의 AccountSwitcher에서
**When** 다른 계정을 클릭하면
**Then** 활성 계정이 즉시 전환된다
**And** 모든 프로젝트 데이터, 프리셋, 설정이 그대로 유지된다

**Given** 계정을 전환한 후
**When** 프로젝트 [시작]을 클릭하면
**Then** 새 계정의 인증 정보로 Claude Code가 실행된다
**And** 프리셋과 프로젝트 설정은 계정 전환 전과 동일하다

**Given** AccountSwitcher 드롭다운이 열릴 때
**When** 계정 목록을 확인하면
**Then** 현재 활성 계정이 하이라이트되어 표시된다

### Story 5.3: 실행 중 팀 계정 전환 경고

As a 사용자,
I want 팀이 실행 중일 때 계정 전환 시 경고를 받길,
So that 실행 중인 작업에 영향을 줄 수 있음을 인지하고 의도적으로 전환할 수 있다.

**Acceptance Criteria:**

**Given** 하나 이상의 프로젝트 팀이 실행 중일 때
**When** 계정 전환을 시도하면
**Then** "실행 중인 팀이 N개 있습니다. 전환하면 실행 중인 팀에 영향을 줄 수 있습니다." 경고가 표시된다
**And** [전환] 과 [취소] 옵션이 제공된다

**Given** 경고에서 [전환]을 선택할 때
**When** 계정이 전환되면
**Then** 실행 중인 팀은 현재 세션을 유지하고, 이후 새로 시작하는 팀만 새 계정을 사용한다

**Given** 실행 중인 팀이 없을 때
**When** 계정 전환을 시도하면
**Then** 경고 없이 즉시 전환된다
