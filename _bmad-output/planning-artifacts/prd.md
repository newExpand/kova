---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-03-success
  - step-04-journeys
  - step-05-domain-skipped
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - product-brief-flow-orche-2026-02-06.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 0
classification:
  projectType: desktop_app
  domain: developer_tool
  complexity: medium
  projectContext: greenfield
  techStack: Tauri v2 + React 19
  targetPlatform: macOS
workflowType: 'prd'
---

# Product Requirements Document - flow-orche

**Author:** flow-orche
**Date:** 2026-02-06

## Executive Summary

**flow-orche**는 Claude Code Agent Teams를 시각적으로 관리하는 macOS 데스크톱 앱이다.

**핵심 문제:** Claude Code 파워유저가 5~8개 프로젝트를 동시에 운영할 때, 각 프로젝트마다 터미널을 열고 디렉토리를 이동하고 Claude를 실행하고 팀 구성을 타이핑하는 반복 작업이 발생한다.

**솔루션:** 프로젝트 카드에서 원클릭으로 에이전트 팀을 구성하고, 대시보드에서 전체 프로젝트 상태를 한눈에 파악하는 GUI 오케스트레이션 도구.

**차별화:** Claude Code Agent Teams의 파일 기반 아키텍처를 직접 활용하는 GUI 도구가 현재 존재하지 않음. 카테고리 창출 제품. AI 모델 발전이 곧 제품 가치 상승으로 이어지는 AI 레버리지 플랫폼 구조.

**대상 사용자:** Claude Code Max 구독 개발자 — 멀티 프로젝트, 멀티 에이전트 워크플로우를 운영하는 파워유저.

**기술 스택:** Tauri v2 (v2.10+) + React 19 + SQLite, macOS 단독 (Apple Silicon + Intel)

## Success Criteria

### User Success

**핵심 성공 순간:**

1. **"원클릭 팀 구성"** — 프로젝트 카드에서 [시작] 클릭 한 번으로 SM + Dev + QA 팀이 자동 구성되어 작업을 시작하는 순간
2. **"한눈에 전체 파악"** — 대시보드를 열었을 때 5~6개 활성 프로젝트의 상태(실행 중/대기/완료/에러)가 즉시 보이는 순간

**사용자 성공 지표:**

- 프로젝트 시작 시 수동 개입 제로 (디렉토리 이동, claude 실행, 팀 구성 지시 전부 불필요)
- 계정 전환 시 프로젝트 데이터 유실 없음
- 프로젝트별 알림으로 어떤 프로젝트에서 무슨 일이 일어나는지 즉시 식별

### Business Success

> 개인 도구이므로 "생산성 지표"가 곧 비즈니스 지표

**3개월 목표:**

- flow-orche가 일상 워크플로우를 완전히 대체 — 기존 터미널 수동 세팅을 더 이상 사용하지 않음
- 5개 이상 활성 프로젝트를 flow-orche에서 관리

**12개월 목표:**

- 자동 프리셋 추천으로 신규 프로젝트 세팅 시간 추가 단축
- (선택) 오픈소스 공개 검토

### Technical Success

**핵심 성능 KPI:**

- 전체 런치 (클릭 → 팀 가동): < 20초
- 앱 Cold Start → 대시보드 표시: < 3초
- UI 반응성: 논블로킹 (런치 중에도 다른 프로젝트 조작 가능)

**안정성 기준:**

- 원클릭 성공률: ≥ 90% (네트워크/인증 문제 제외)
- 프로젝트별 알림 정확 라우팅: 100%
- 계정 전환 후 데이터 무결성: 100%

### Measurable Outcomes

| KPI | 측정 방법 | MVP 목표 |
|-----|----------|---------|
| 터미널 대체율 | 기존 수동 세팅 사용 횟수 = 0 | 100% 대체 |
| 원클릭 성공률 | 시작→팀 구성 성공 / 전체 시도 | ≥ 90% |
| 전체 런치 시간 | 클릭→팀 가동 소요 시간 | ≤ 20초 |
| 프로젝트 관리 수 | 동시 관리 활성 프로젝트 | ≥ 5개 |
| 알림 정확도 | 올바른 프로젝트로 라우팅 | 100% |

## User Journeys

### Journey 1: 승민의 하루 — 일상적인 멀티 프로젝트 워크플로우 (Happy Path)

**Opening Scene:**
월요일 아침, 승민은 커피 한 잔을 들고 맥북 앞에 앉는다. 이번 주에 진행해야 할 프로젝트가 3개다 — 회사의 결제 시스템 리팩토링, 개인 SaaS 프로젝트의 인증 모듈, 그리고 오픈소스 라이브러리 버그 수정. 예전이라면 각 프로젝트마다 터미널을 열고, 디렉토리를 이동하고, Claude를 실행하고, 팀 구성을 처음부터 타이핑해야 했다.

**Rising Action:**
flow-orche를 실행한다. 대시보드에 등록된 6개 프로젝트 카드가 한눈에 보인다. 결제 시스템 프로젝트 카드를 클릭하고 [시작]을 누른다. 카드에 저장된 프리셋대로 SM(1) + Dev(2) + QA(1) 팀이 자동 구성된다. 팀이 가동되는 동안 옆에 있는 SaaS 프로젝트도 [시작]을 누른다 — 이쪽은 SM(1) + Dev(1) + QA(1)로 더 가볍게.

**Climax:**
두 프로젝트의 에이전트 팀이 동시에 돌아간다. 대시보드에서 결제 시스템의 Dev 에이전트가 스토리 2개를 병렬로 작업 중인 것이 보이고, SaaS 프로젝트의 SM이 첫 번째 스토리를 할당한 상태다. 30분 후, SaaS 프로젝트에서 macOS 알림이 뜬다 — "SaaS Auth: 스토리 완료, QA 리뷰 대기 중." 어떤 프로젝트의 알림인지 즉시 식별된다.

**Resolution:**
점심 전까지 SaaS 프로젝트의 스토리 3개가 QA까지 통과했고, 결제 시스템은 Dev가 아키텍처 변경 중이다. 승민은 커피를 마시며 대시보드를 한눈에 확인하고, 오후에는 오픈소스 프로젝트를 [시작]할 계획이다. 기존에 프로젝트 전환마다 수 분씩 걸리던 세팅 시간이 사라졌다.

**드러나는 요구사항:** 프로젝트 카드 목록 + 상태 표시 (F1), 원클릭 팀 실행 + 다중 프로젝트 동시 실행 (F2), 프로젝트별 프리셋 저장/적용 (F3), 프로젝트별 구분 알림 (F4)

### Journey 2: 승민의 위기 — 에러와 장애 대응 (Edge Case)

**Opening Scene:**
오후 3시, 승민은 결제 시스템 프로젝트의 Dev 에이전트가 20분째 응답이 없는 것을 발견한다. 대시보드에서 해당 에이전트의 상태가 "stuck"으로 표시된다.

**시나리오 A — 에이전트 stuck:**
앱에서 해당 프로젝트의 [중지]를 누른다. tmux 세션이 정리된다. 다시 [시작]을 누르면 프리셋 그대로 팀이 재구성된다.

**시나리오 B — 토큰 소진:**
계정A의 토큰이 소진되었다는 알림이 뜬다. 앱 내에서 계정B로 전환한다. 프로젝트 데이터와 프리셋은 그대로 유지된 채로, 새 계정으로 팀이 재시작된다.

**시나리오 C — 팀 스폰 실패:**
Claude Code가 팀 프롬프트에 응답하지 않는다. 앱이 폴링 타임아웃을 감지하고, "팀 구성 실패 — Claude Code 응답 없음" 알림과 함께 재시도/수동 전환 옵션을 제공한다.

**Resolution:**
각 시나리오에서 승민은 앱을 떠나지 않고 문제를 해결한다. "이 앱 안에서 다 된다"는 확신이 일상 대체의 핵심이다.

**드러나는 요구사항:** 세션 상태 감지/stuck 판별 (F2), [중지] → tmux 정리 → 재시작 (F2), 계정 전환 시 데이터 독립 (F5), 실패 감지 + 타임아웃 + 재시도 (F2), 에러 알림 (F4)

### Journey 3: 승민의 첫날 — Onboarding (First-Time Experience)

**Opening Scene:**
승민이 flow-orche를 처음 설치하고 실행한다. 빈 대시보드가 나타나고, 환경 감지가 자동으로 시작된다.

**Rising Action:**
앱이 시스템을 스캔한다 — Claude Code CLI ✅, tmux ✅, 인증 상태 ✅. 모든 체크 통과 시 "환경 준비 완료" 표시. tmux 미설치 시 `brew install tmux` 안내와 재확인 버튼 제공. 다음으로 계정 등록 — Max*20 계정 2개를 프로필로 등록한다.

**Climax:**
첫 프로젝트를 등록한다. 로컬 디렉토리 선택, 프로젝트 이름 입력, 기본 프리셋(SM+Dev+QA) 자동 제안. Dev를 2명으로 조정하고 [시작]. 20초 안에 팀이 가동된다.

**Resolution:**
"아, 이거 한 번 세팅하면 다음부터는 클릭 한 번이구나." 핵심 가치를 첫 경험에서 체험한다.

**드러나는 요구사항:** 환경 자동 감지 + 안내 메시지, 계정 프로필 등록 (F5), 프로젝트 등록 (F1, F3), 기본 프리셋 자동 제안 (F3), 첫 팀 실행 성공 (F2)

### Journey Requirements Summary

| 여정 | 드러나는 핵심 기능 영역 |
|------|----------------------|
| 일상 워크플로우 | 프로젝트 허브, 원클릭 실행, 프리셋, 프로젝트별 알림 |
| 에러/장애 대응 | 세션 정리/재시작, 계정 전환, 실패 감지/타임아웃, 에러 알림 |
| Onboarding | 환경 감지, 계정 등록, 프로젝트 등록, 기본 프리셋 제안 |

## Innovation & Novel Patterns

### Detected Innovation Areas

1. **Claude Code Agent Teams 네이티브 GUI — 카테고리 창출**
   - Agent Teams의 파일 기반 아키텍처(`~/.claude/teams/`, `~/.claude/tasks/`)를 직접 활용하는 GUI 도구가 현재 존재하지 않음
   - CLI 전용 멀티 에이전트 오케스트레이션을 시각적으로 관리하는 최초의 데스크톱 앱

2. **AI 레버리지 플랫폼 구조**
   - 앱 코드 업데이트 없이도 Claude 모델 업그레이드가 에이전트 품질 향상 → 제품 가치 자동 상승
   - 외부 AI 발전이 제품의 핵심 가치를 증폭시키는 구조

3. **tmux send-keys 기반 CLI→GUI 자동화 패턴**
   - CLI 도구(Claude Code)를 GUI에서 프로그래밍적으로 제어하는 독특한 통합 방식
   - API 호출이 아닌 터미널 세션 제어 접근법

### Market Context

- 경쟁 제품 없음 — Claude Code Agent Teams GUI 관리 도구는 시장에 존재하지 않음
- 인접 도구들(VS Code Extension, Cursor, Windsurf)은 Agent Teams 생태계와 호환되지 않음
- Anthropic이 Agent Teams를 전략적으로 발전시키고 있어 수요 증가 예상

### Validation Approach

- MVP로 본인 검증: 일상 워크플로우 완전 대체 여부로 핵심 가치 검증
- AI 레버리지 효과: Claude 모델 업데이트 전후 오케스트레이션 품질 비교

## Desktop App Specific Requirements

### Platform Support

- **Target OS:** macOS 단독 (Apple Silicon + Intel)
- **최소 버전:** macOS 13 Ventura 이상 (Tauri v2 요구사항)
- **크로스 플랫폼:** MVP 스코프 아님. 향후 Linux 확장 가능성 열어둠

### System Integration

| 통합 대상 | 방식 | 용도 |
|-----------|------|------|
| tmux | Rust Command API → tmux CLI | 세션 생성/제어/정리 |
| Claude Code CLI | tmux send-keys | 실행, 팀 프롬프트 전송 |
| Claude Code Hooks | 파일시스템 감시 또는 hooks 이벤트 수신 | 프로젝트별 알림 |
| macOS Notification Center | Tauri notification plugin | 네이티브 알림 |
| SQLite | Tauri SQL plugin 또는 Rust 직접 | 프로젝트/프리셋/계정 데이터 |
| 파일 시스템 | Tauri fs plugin | 프로젝트 디렉토리 접근, 설정 파일 |

### Update Strategy

- **MVP:** 수동 빌드/배포 (본인 사용)
- **팀 공유 시점:** Tauri 내장 Updater + GitHub Releases (private repo 토큰 인증, 서명 검증, .dmg 최초 1회 배포 후 자동 업데이트)
- **장기:** 오픈소스 전환 시 Homebrew cask 등록 검토

### Offline Capabilities

- **오프라인 가능:** 프로젝트 관리, 프리셋 편집, 계정 프로필, 알림 히스토리, 설정 — 모든 로컬 데이터 CRUD
- **오프라인 불가:** 팀 실행(Claude Code 네트워크 필요), 계정 인증 전환, auto-update
- **원칙:** SQLite 로컬 저장 기반 네트워크 독립 UI. 네트워크 없을 시 Claude Code 기능만 비활성화

### Implementation Considerations

- Tauri v2 보안 모델(권한 시스템) 준수 — tauri.conf.json에서 필요 권한만 선언
- Rust 백엔드에서 tmux/Claude Code 프로세스 관리 — 비동기 처리로 UI 블로킹 방지
- React 19 프론트엔드 — Tauri IPC를 통해 Rust 백엔드와 통신

## Project Scoping & Phased Development

### MVP Strategy

**접근:** Problem-Solving MVP — 본인의 구체적인 Pain Point를 해결하는 최소 제품. 사용자=개발자 본인이므로 검증 루프가 매우 짧음.

**리소스:** 1인 개발자 (Claude Code Agent Teams 활용 AI 보조 개발)

### Phase 1a — 최소 동작 단위 (핵심 가치 검증)

"프로젝트 카드 클릭 → 팀 자동 구성"

- **F1. 프로젝트 허브** — 프로젝트 등록/목록/설정 저장/상태 표시
- **F2. 원클릭 팀 실행** — tmux 세션 자동 생성 → Claude Code 실행 → 팀 프롬프트 전송, [중지] 시 세션 정리
- **F3. 팀 프리셋** — 프로젝트별 팀 구성 수동 저장/편집, 기본 프리셋(SM+Dev+QA) 제공

지원 여정: Journey 1(기본), Journey 3(Onboarding)
수동 대체: 알림 → 터미널 확인, 계정 전환 → CLI

### Phase 1b — 완성된 MVP (터미널 완전 대체)

- **F4. 프로젝트별 알림** — Claude hooks 이벤트 수신, 앱 내 알림 + macOS 네이티브 알림
- **F5. 다중 계정 관리** — 계정 프로필 등록, 원클릭 전환, 데이터 독립

추가 여정: Journey 1(완전판), Journey 2(에러 대응)

### Phase 2 — Growth (v2.0)

- 실시간 대시보드 (태스크 상태/의존성 그래프 시각화)
- 자동 프리셋 추천 (프로젝트 분석 기반)
- Git worktree 자동 관리
- ~~앱 내 터미널 임베딩 (xterm.js)~~ → MVP로 이동됨 (ghostty-web 읽기 전용 뷰, UX 스펙 결정)
- Tauri Updater + GitHub Releases 자동 업데이트

### Phase 3 — Expansion (v3.0+)

- 팀 구성 패턴 학습 및 재추천
- 프로젝트 간 지식 전파
- 토큰 사용량 최적화 대시보드
- 커뮤니티 프리셋 공유 (오픈소스 전환 시)
- Homebrew cask 배포

### Risk Mitigation

| 리스크 | 영향도 | 대응 |
|--------|--------|------|
| tmux send-keys → Claude Code 제어 안정성 | 높음 — F2 전체 의존 | Phase 1a에서 가장 먼저 PoC 검증. 프롬프트 준비 감지 폴링 안정성 확인 |
| Claude Code Hooks 이벤트 수신 | 중간 — F4 의존 | Phase 1b에서 구현. hooks 파일시스템 구조 파악, 불안정 시 tmux 출력 감시 fallback |
| Agent Teams 실험적 플래그 변경 | 낮음 — Anthropic 전략 방향성에 부합 | 환경변수/옵션을 설정으로 분리하여 유지보수 용이하게. 기능 소멸 가능성 낮음 |
| tmux 의존성 | 낮음 | macOS Homebrew 안정 설치. 환경 감지에서 버전 호환성 체크 |
| Claude Code CLI 인증 변경 | 낮음 | claude auth 기반 OAuth 표준 패턴. CLI 업데이트 추적 |

**시장 리스크:** 없음 — 본인이 1차 사용자
**리소스 리스크:** 1인 개발, Phase 1a → 1b 순차 진행으로 부담 분산

## Functional Requirements

### 프로젝트 관리

- **FR1:** 사용자는 로컬 디렉토리 경로를 지정하여 새 프로젝트를 등록할 수 있다
- **FR2:** 사용자는 등록된 프로젝트 목록을 카드 형태로 조회할 수 있다
- **FR3:** 사용자는 프로젝트의 이름, 경로, 사용할 계정, 기본 프롬프트 등 설정을 편집할 수 있다
- **FR4:** 사용자는 프로젝트를 삭제할 수 있다
- **FR5:** 시스템은 각 프로젝트의 현재 상태(활성/비활성/에러)를 표시한다

### 팀 실행 및 제어

- **FR6:** 사용자는 프로젝트 카드에서 원클릭으로 에이전트 팀을 시작할 수 있다
- **FR7:** 시스템은 팀 시작 시 tmux 세션을 자동 생성하고 프로젝트 디렉토리로 이동한다
- **FR8:** 시스템은 tmux 세션에서 Claude Code를 Agent Teams 모드로 자동 실행한다
- **FR9:** 시스템은 Claude Code 프롬프트 준비 상태를 감지한 후 팀 프리셋 프롬프트를 자동 전송한다
- **FR10:** 사용자는 실행 중인 프로젝트의 에이전트 팀을 중지할 수 있다
- **FR11:** 시스템은 팀 중지 시 관련 tmux 세션을 정리한다
- **FR12:** 사용자는 여러 프로젝트의 에이전트 팀을 동시에 실행할 수 있다
- **FR13:** 시스템은 팀 스폰 실패(타임아웃, Claude Code 응답 없음)를 감지하고 사용자에게 알린다
- **FR14:** 사용자는 팀 스폰 실패 시 재시도할 수 있다

### 팀 프리셋 관리

- **FR15:** 사용자는 프로젝트별 팀 프리셋을 생성할 수 있다 (역할 구성: SM, Dev, QA 등, 각 역할의 수)
- **FR16:** 사용자는 팀 프리셋의 각 역할별 프롬프트를 커스터마이즈할 수 있다
- **FR17:** 시스템은 기본 팀 프리셋(SM+Dev+QA)을 제공한다
- **FR18:** 사용자는 프리셋을 편집하고 삭제할 수 있다

### 알림 (Phase 1b)

- **FR19:** 시스템은 각 프로젝트의 Claude hooks 이벤트(작업 완료, 사용자 입력 대기, 에러)를 수신한다
- **FR20:** 시스템은 알림을 프로젝트별로 구분하여 앱 내 알림 패널에 표시한다
- **FR21:** 시스템은 주요 이벤트 발생 시 macOS 네이티브 알림을 표시한다
- **FR22:** 사용자는 알림 히스토리를 프로젝트별로 조회할 수 있다

### 계정 관리 (Phase 1b)

- **FR23:** 사용자는 여러 Claude Max 계정 프로필을 등록할 수 있다
- **FR24:** 사용자는 각 계정 프로필에 이름을 부여할 수 있다
- **FR25:** 사용자는 앱 내에서 원클릭으로 활성 계정을 전환할 수 있다
- **FR26:** 시스템은 계정 전환 시 프로젝트 데이터와 프리셋을 독립적으로 보장한다
- **FR27:** 시스템은 실행 중인 팀이 있을 때 계정 전환을 경고한다

### 환경 및 Onboarding

- **FR28:** 시스템은 첫 실행 시 필수 의존성(Claude Code CLI, tmux, 인증 상태)을 자동 감지한다
- **FR29:** 시스템은 누락된 의존성에 대해 설치 안내 메시지를 표시한다
- **FR30:** 사용자는 의존성 설치 후 재확인을 요청할 수 있다

### 데이터 및 오프라인

- **FR31:** 시스템은 모든 프로젝트/프리셋/계정 데이터를 로컬(SQLite)에 저장한다
- **FR32:** 사용자는 네트워크 없이도 프로젝트 관리, 프리셋 편집, 설정 변경을 할 수 있다
- **FR33:** 시스템은 네트워크 미연결 시 Claude Code 의존 기능만 비활성화 상태로 표시한다

### 글로벌 UX

- **FR34:** 사용자는 Cmd+K 커맨드 팔레트로 프로젝트 검색, 빠른 액션 실행, 설정 접근을 할 수 있다

## Non-Functional Requirements

### Performance

| 항목 | 기준 | 측정 방법 |
|------|------|----------|
| 앱 Cold Start → 대시보드 표시 | < 3초 | Tauri 앱 실행 ~ 첫 화면 렌더 |
| 프로젝트 카드 클릭 → tmux 세션 생성 | < 2초 | 클릭 이벤트 ~ tmux session 확인 |
| Claude Code 실행 → 프롬프트 준비 감지 | < 10초 | CLI 시작 ~ 프롬프트 감지 (폴링 주기 500ms) |
| 팀 프리셋 프롬프트 전송 | < 5초 | send-keys ~ 팀 스폰 시작 확인 |
| 전체 런치 (클릭 → 팀 가동) | < 20초 | 카드 클릭 ~ 에이전트 팀 활동 시작 |
| UI 반응성 | 논블로킹 | 런치/중지 중에도 다른 프로젝트 카드 조작 가능 |
| 프로젝트 목록 로드 | < 500ms | SQLite 쿼리 ~ 카드 렌더 완료 |
| 프롬프트 준비 감지 타임아웃 | 30초 | 타임아웃 초과 시 실패 알림 + 재시도 옵션 |

### Security

- 계정 인증 토큰은 macOS Keychain을 통해 안전하게 저장한다 (평문 저장 금지)
- SQLite DB 파일은 앱 전용 디렉토리에 저장하며, 민감하지 않은 데이터(프로젝트 경로, 프리셋 내용)만 포함한다
- OAuth 인증은 Claude Code CLI(claude auth)에 위임하며, 앱이 직접 자격 증명을 처리하지 않는다

### Integration

| 통합 대상 | 안정성 기준 | 장애 대응 |
|-----------|-----------|----------|
| tmux CLI | 세션 생성/제어 명령 성공률 99% | 실패 시 재시도 1회, 이후 사용자에게 에러 표시 |
| Claude Code CLI | 실행 및 프롬프트 감지 성공률 90%+ | 타임아웃(30초) 초과 시 실패 알림 + 재시도/수동 옵션 |
| Claude Code Hooks | 이벤트 수신 지연 < 5초 | hooks 감시 실패 시 tmux 출력 감시로 fallback |
| macOS Notification Center | 알림 전달률 100% (OS 레벨) | Tauri notification plugin 기반, 실패 시 앱 내 알림만 표시 |
| 파일 시스템 | 프로젝트 디렉토리 접근 가능 확인 | 디렉토리 없거나 권한 없을 시 프로젝트 상태 에러 표시 |
