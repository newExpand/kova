# Git Feature Enhancement Roadmap — Agent Workflow 특화

## Context

flow-orche의 git graph/worktree panel에 "에이전트 워크플로우 특화" 인터랙션을 추가한다.
일반 Git GUI(GitKraken, Fork)와 경쟁하지 않고, 에이전트 오케스트레이터만이 할 수 있는
고수준 액션을 제공하여 차별화한다.

핵심 원칙:
- raw git 명령이 아닌 **에이전트 작업 단위의 액션** 제공
- Claude Code `--worktree` 워크플로우와 자연스럽게 연결
- View 기능은 에이전트 관측(observability)에 집중

> **Note**: 본 문서는 방향성을 잡기 위한 **로드맵**이다.
> 실제 개발 단계에서 코드베이스 아키텍처, 기술 스택, UI/UX 디자인 등
> 디테일한 부분은 구현 시점에 심도 있게 검토하며, 더 나은 접근법이
> 발견되면 얼마든지 변경될 수 있다.
> 아래 명시된 수정 파일, 구현 방식, 예상 시간은 참고용이며
> 개발 진행에 따라 조정된다.

---

## Phase 1: 기반 인터랙션 — ✅ 완료 (2026-02-21)

> 기존 컴포넌트를 연결하고, 상호작용의 기초를 만든다.

### 1.1 Worktree 클릭 → Terminal 네비게이션 ✅

WorktreeCard 클릭 시 해당 worktree의 터미널로 이동.

**구현 내용:**
- `WorktreeCard`를 `<motion.button>`으로 전환 (시맨틱 HTML)
- 클릭 → `/projects/${projectId}/terminal` 네비게이션
- collapsed `WorktreeCollapsedDot`에도 클릭 핸들러 적용
- Framer Motion: `whileHover={{ scale: 1.02 }}`, `whileTap={{ scale: 0.98 }}`
- hover: `bg-white/[0.05]`, `border-white/[0.12]`, `transition 150ms ease-out`
- `aria-label` (branch명 + dirty/clean 상태), `focus-visible:ring-2`

### 1.2 Branch ↔ Worktree 양방향 크로스 하이라이트 ✅

WorktreeCard hover 시 그래프에서 해당 branch lane 강조, 나머지 dim.
그래프 commit row hover 시 해당 WorktreeCard 역강조.

**구현 내용:**
- `GitGraphPage` 로컬 state `hoveredBranch` + sticky hover (50ms 딜레이)
- **방향 A** (Worktree → Graph): WorktreeCard hover → color matching → 해당 lane 강조
- **방향 B** (Graph → Worktree): commit row hover → `colorToBranch` Map으로 branch 역추적 → WorktreeCard 강조
- dimmed 노드: `opacity 0.3`, dimmed 엣지: `opacity 0.2 + grayscale(1)`
- 하이라이트 엣지: `opacity 1.0`, `strokeWidth 3px`, `drop-shadow(0 0 3px {color})` glow
- 역하이라이트 카드: `scale 1.02`, `border-white/[0.12]`
- `prefers-reduced-motion` 존중 (pulse 비활성화)
- OKLCH Lightness L=0.7 (>= 0.65 WCAG 대비 보장)

**수정 파일:**
- `src/features/git/components/GitGraphPage.tsx` — hoveredBranch state, sticky hover, togglePanel
- `src/features/git/components/WorktreePanel.tsx` — click, hover, 역하이라이트, useNavigate 리프트업
- `src/features/git/components/BranchGraph.tsx` — highlightBranch, colorToBranch, dim 로직
- `src/features/git/components/CommitNode.tsx` — isDimmed prop
- `src/features/git/components/BranchLine.tsx` — isDimmed/isHighlighted, glow 효과
- `src/features/git/hooks/useGitGraph.ts` — OKLCH 대비 주석

**디자인 리뷰:** Gemini 2.5 Pro + 3 Pro 리뷰 반영
**코드 리뷰:** pr-review-toolkit 6개 이슈 수정, React/Zustand 스킬 리뷰 통과

---

## Phase 2: 커밋 상세 & Agent Attribution — ✅ 완료

> 커밋을 클릭하면 에이전트가 뭘 했는지 한눈에 볼 수 있게 한다.

### 2.1 Commit Detail Panel ✅

커밋 선택 시 하단 패널에 diff + 에이전트 정보 표시.

**구현 내용:**
- 커밋 메타데이터 (author, email, date, full message, parents)
- `Co-Authored-By: Claude` 감지 시 `[✨ Claude]` 뱃지 (보라색 glow)
- 변경 통계 (`+N -M, K files changed`, 색상 구분)
- 파일별 diff (Framer Motion collapsible, oklch 기반 줄별 색상)
- 정보 계층: Header → Message → Meta → Stats → Files
- 헤더 더블클릭 시 40vh ↔ 80vh 토글
- Enter 애니메이션 (y:20→0, opacity 0→1, 0.2s)
- Esc 키로 패널 닫기, hash 클릭 시 클립보드 복사

**수정 파일:**
- `src-tauri/src/models/git.rs` — `is_agent_commit` + CommitDetail/DiffStats/FileDiff/FileStatus 추가
- `src-tauri/src/services/git.rs` — `%b`+`%x1e` 파서, `detect_agent_commit()`, `get_commit_detail()`, `parse_unified_diff()`
- `src-tauri/src/commands/git.rs` — `get_commit_detail` 커맨드
- `src/features/git/components/CommitDetailPanel.tsx` — 신규 (하단 상세 패널)
- `src/features/git/components/GitGraphPage.tsx` — vertical flex 레이아웃
- `src/features/git/stores/gitStore.ts` — commitDetail state/actions

### 2.2 Agent Attribution 표시 ✅

커밋 리스트에서 에이전트가 만든 커밋을 시각적으로 구분.

**구현 내용:**
- `Co-Authored-By: Claude` 패턴 감지 (case-insensitive, git log body 파싱)
- 커밋 행에 `[✨ AI]` 뱃지 (Sparkles 아이콘, 보라색 glow shadow)
- `aria-label="AI Agent commit"` 접근성

**수정 파일:**
- `src/features/git/components/BranchGraph.tsx` — AI 뱃지 추가

**디자인 리뷰:** Gemini UI/UX 리뷰 반영 (정보 계층, oklch 색상, Framer Motion)
**코드 리뷰:** spec compliance + code quality + pr-review-toolkit (code-reviewer, silent-failure-hunter) 통과

**PR 리뷰 수정:**
- `detailError` 상태 추가 — IPC 에러를 UI에 표시 (기존: "No detail available"로 swallow)
- Race condition guard — stale response가 잘못된 커밋 데이터 표시 방지
- Clipboard 실패 피드백 — 복사 실패 시 빨간 X 아이콘 표시
- Escape key scope — dialog/modal 열려있을 때 충돌 방지
- `projectPath` null guard — project 없을 때 패널 미렌더링
- Rust diff 파서 warn 로그 — 파싱 실패 시 `tracing::warn!` 추가

**UX 개선 (사용자 피드백 반영):**
- 패널 기본 높이 `40vh → 50vh` 증가
- 파일 diff 자동 펼침 (기본: 전체 확장)
- Expand All / Collapse All 토글 버튼 추가
- 폰트 사이즈 1단계 증가 (text-[10px] → text-[11px], text-[11px] → text-xs)

**Tauri 스킬 규칙 준수:**
- git 커맨드 3개 `async fn` 전환 — main thread blocking 해소

---

## Phase 2.5: Working Tree Changes Viewer — ✅ 완료 (2026-02-21)

> 커밋 전 작업 중인 변경사항을 워크트리별로 볼 수 있게 한다.

### 2.5.1 Working Changes Read-only 뷰어 ✅

워크트리별 uncommitted 변경사항(staged/unstaged/untracked)을 하단 패널에서 확인.
CommitDetailPanel과 같은 영역을 공유하며, 상호 배타로 동작.

**설계 과정:** Gemini 2차 리뷰 + Codex 리뷰 + 자체 분석

**핵심 설계 결정:**
- **배치**: 하이브리드 C+A (WorktreeCard dirty 뱃지 클릭 → 하단 패널 뷰어)
- **카드 클릭 UX**: 카드 본체=터미널 이동(기존 유지), dirty 뱃지=변경사항 패널
- **상호 배타**: `selectedCommitHash` vs `selectedWorktreePath` — store 레벨 강제
- **컴포넌트 전략**: DiffViewer 추출 (CommitDetailPanel에서 diff 로직 공유 컴포넌트 분리)

**구현 내용:**

Rust Backend:
- `FileStatus::Untracked` variant 추가
- `WorkingChanges` struct + `WorkingChanges::new()` constructor (stats 자동 계산)
- `get_working_changes()` — `git diff --cached` + `git diff` + `git ls-files --others`
- `GitWorktree.status: Option<GitStatus>` — 폴링 시 워크트리별 개별 dirty 상태
- Untracked 파일: 내용 읽어 synthetic diff 생성 (1MB 제한, 바이너리 감지, path traversal 방어)
- `get_working_changes` IPC 커맨드 + `is_dir()` 입력 검증

Frontend:
- `DiffViewer.tsx` — CommitDetailPanel에서 추출한 공유 diff 뷰어 (`FileDiffRow`, `DiffFileList`, `STATUS_BADGES`, `getDiffLineClass`)
- `WorkingChangesPanel.tsx` — 3개 섹션 (Staged/Unstaged/Untracked), ESC 닫기, 로딩/에러 상태
- `gitStore.ts` — `selectedWorktreePath`, `workingChanges` 상태 + 상호 배타 + stale response guard
- `WorktreePanel.tsx` — per-worktree dirty 뱃지 (클릭 가능, `stopPropagation`, 접근성)
- `GitGraphPage.tsx` — 하단 패널 조건부 렌더링 (`CommitDetailPanel` OR `WorkingChangesPanel`)

**수정 파일:**
- `src-tauri/src/models/git.rs` — FileStatus::Untracked, WorkingChanges, GitWorktree.status
- `src-tauri/src/services/git.rs` — get_working_changes(), get_graph_data 워크트리별 status
- `src-tauri/src/commands/git.rs` — get_working_changes 커맨드
- `src-tauri/src/lib.rs` — generate_handler! 등록
- `src/lib/tauri/commands.ts` — WorkingChanges 타입, getWorkingChanges wrapper
- `src/features/git/components/DiffViewer.tsx` — **신규** (공유 diff 뷰어)
- `src/features/git/components/WorkingChangesPanel.tsx` — **신규** (하단 패널)
- `src/features/git/components/CommitDetailPanel.tsx` — diff 로직 추출 → DiffViewer import
- `src/features/git/components/GitGraphPage.tsx` — 하단 패널 조건부 렌더링
- `src/features/git/components/WorktreePanel.tsx` — dirty 뱃지 클릭 핸들러, per-worktree status
- `src/features/git/stores/gitStore.ts` — working changes 상태 + 상호 배타
- `src/features/git/types.ts`, `src/features/git/index.ts` — barrel export

**PR 리뷰 수정 (pr-review-toolkit + Codex):**
- `std::fs::read()` 에러 로깅 (`warn!` + 에러 메시지 표시)
- 파일 크기 1MB 제한 (OOM 방지)
- Path traversal 방어 (`canonicalize` + `starts_with`)
- `DiffFileList` expanded state re-sync (`useEffect`)
- `selectWorktree`에서 이전 `workingChanges` 초기화
- `worktree.status: null` 시 root fallback 제거 (잘못된 정보 방지)
- Error 체크 순서 수정 (error → workingChanges)
- `canonicalize(root)` 루프 외부 호이스팅 (성능)
- `WorkingChanges::new()` constructor (stats 일관성 보호)
- `worktree_path` `is_dir()` 입력 검증

---

## Phase 2.6: Git Graph 인라인 커밋 — ✅ 완료 (2026-02-22)

> Git Graph에서 터미널 전환 없이 파일 staging, 커밋, 인라인 터미널까지 완결.

### 2.6.1 Stage / Unstage / Discard 파일 액션 ✅

DiffViewer 파일 행에 인터랙티브 버튼 추가.

**구현 내용:**

Rust Backend:
- `stage_files()`, `stage_all()` — `git add`
- `unstage_files()`, `unstage_all()` — `git restore --staged` (git 2.23+)
- `discard_file()` — tracked: `git restore --`, untracked: `git clean -f --`
- `create_commit()` — `git commit -m` + `git rev-parse --short HEAD`
- `validate_worktree()` — `is_dir()` 체크
- `validate_file_path()` — path traversal 방어 + `canonicalize` 검증
- 11개 단위 테스트 (기존 `create_test_repo()` 헬퍼 재사용)
- 모든 에러 경로에 `tracing::error!` 추가

Frontend:
- `DiffViewer.tsx` — `FileDiffRow`에 `+` (stage), `-` (unstage), `x` (discard) 버튼
- `DiffFileList`에 `BulkAction` 인터페이스 (`onAction` + `label` 단일 객체)
- Discard 2-click 안전장치 (3초 타이머, useRef 기반)
- Staged 섹션: unstage만 제공 (discard는 의미 없음)

**수정 파일:**
- `src-tauri/src/services/git.rs` — 7개 서비스 함수 + validation 헬퍼
- `src-tauri/src/models/git.rs` — `CommitResult` struct
- `src-tauri/src/commands/git.rs` — 6개 Tauri 커맨드
- `src-tauri/src/lib.rs` — `generate_handler!` 등록
- `src/lib/tauri/commands.ts` — 6 IPC wrapper + `CommitResult` 타입
- `src/features/git/stores/gitStore.ts` — staging/commit 상태 + 액션
- `src/features/git/components/DiffViewer.tsx` — 파일별 액션 버튼 + `BulkAction`

### 2.6.2 CommitBox 컴포넌트 ✅

WorkingChangesPanel 내 커밋 메시지 입력 + 커밋 실행.

**구현 내용:**
- Subject (1줄, max 72자) + Body (optional, 접기/펼치기) 분리 입력
- `Cmd+Enter` 단축키 커밋
- staged 0개 → "Stage files to commit" 안내 + "Stage All Changes" 원클릭 버튼
- staged > 0 → 커밋 메시지 입력 UI 전환
- 커밋 성공 → short hash 인라인 표시 (3초 fade) + 그래프 자동 갱신
- 커밋/refresh 분리 — 커밋 성공 후 refresh 실패 시 사용자 혼동 방지
- `isStagingInProgress` 로딩 상태 — 연속 클릭 방지
- worktree 전환 시 commit 상태 자동 초기화 (`commitInitialState`)
- body 접기: CommitBox 외부 blur 시 빈 body 자동 접힘

**수정 파일:**
- `src/features/git/components/CommitBox.tsx` — **신규**
- `src/features/git/components/WorkingChangesPanel.tsx` — CommitBox 통합 + staging 콜백
- `src/features/git/components/GitGraphPage.tsx` — `projectId`/`projectPath`/`sessionName` props 전달

### 2.6.3 인라인 터미널 ✅

CommitBox 내 터미널 아이콘 클릭 → 기존 tmux 세션에 attach하는 인라인 xterm.js 터미널.

**구현 내용:**
- `InlineTerminal.tsx` — 경량 xterm.js + tauri-pty 컴포넌트
- `tmux new-session -A -s <sessionName>` — 기존 세션 attach (새 세션 미생성)
- 250px 고정 높이, FitAddon 자동 크기 조절, ResizeObserver
- PTY kill 시 tmux 세션 자체는 유지
- `React.lazy` 동적 로드 (xterm.js 번들 분리 유지)
- Promise cleanup `.catch()` 추가 (unhandled rejection 방지)

### 2.6.4 UX 개선 ✅

**패널 안정성:**
- WorkingChangesPanel + CommitDetailPanel: `min-h-[50vh] max-h-[50vh]` 고정 → 새로고침 시 레이아웃 흔들림 방지
- WorkingChangesPanel 헤더에 🔄 새로고침 버튼 (RefreshCw, 로딩 시 회전)

**기타:**
- `.gitignore`에 `.claude/` 추가 (워크트리/로컬 설정 제외)

**PR 리뷰 수정 (pr-review-toolkit 4개 에이전트 + Codex):**
- 커밋/refresh 분리 (Critical: 성공+새로고침 실패 혼동 방지)
- `isStagingInProgress` 로딩 상태 추가 (Critical: 연속 클릭 방지)
- `selectWorktree`에서 commit 상태 초기화 (Critical: worktree 전환 시 오래된 메시지 유지 방지)
- 모든 Rust 에러 경로에 `tracing::error!` (Critical: CLAUDE.md 규칙 준수)
- `validate_file_path` canonicalize 강화 (Important: path traversal 방어)
- `TempFileGuard` RAII struct (Important: temp 파일 정리 보장) — 이후 headless 제거로 삭제
- staged 섹션에서 discard 제거 (Important: 무의미한 동작 방지)
- `resolve_claude_path` 실패 캐시 방지 (Important: 미설치→설치 후 재탐색)
- 에러 자동소멸 제거 + truncate 제거 (Important: 에러 가시성 개선)
- `BulkAction` 인터페이스 (Suggestion: paired props 타입 안전성)
- React 훅 순서 버그 수정 (`handleBoxBlur` early return 전 이동)

**Codex 전체 코드베이스 리뷰 반영 (기존 코드 기술 부채):**
- `agent_activity.rs` — 음수 LIMIT 방지 (`.clamp(0, 10_000)`)
- `settings.rs` — 로그에서 설정값 제거 (키만 로깅)
- `hooks.rs` — Hook cleanup 매칭 강화 (`&type=` 체크 추가)

---

## Phase 3: 에이전트 워크플로우 액션 — 🔶 부분 완료

> git graph를 "관제탑"으로 만드는 핵심 기능.

### 3.1 "New Agent Task" 버튼 ✅ (dc0a0bc, 2026-02-21)

WorktreePanel 헤더에 "+" 버튼 → 새 에이전트 태스크 원클릭 시작.

**구현 내용:**
- `NewAgentTaskDialog` — 태스크 이름 입력 다이얼로그
- 새 tmux window per worktree: `claude --dangerously-skip-permissions --worktree <name>`
- Rust `agent` service layer — tmux + git worktree 생성 오케스트레이션
- Optimistic navigation: WorktreeCard 클릭 시 tmux window 백그라운드 선택
- Session restore: 기존 worktree에 대한 윈도우 자동 재생성

**수정 파일:**
- `src/features/git/components/NewAgentTaskDialog.tsx` — 신규
- `src/features/git/components/WorktreePanel.tsx` — "+" 버튼 추가
- `src-tauri/src/services/agent.rs` — 신규 (worktree + tmux 오케스트레이션)
- `src-tauri/src/commands/agent.rs` — 신규 (IPC 핸들러)
- `src-tauri/src/models/agent.rs` — 신규 (AgentTask 모델)
- `src/lib/tauri/commands.ts` — agent IPC wrappers 추가

### 3.2 커밋 컨텍스트 메뉴

커밋 우클릭 → 에이전트 관련 액션 메뉴.

| 액션 | 설명 |
|---|---|
| **Copy hash** | 클립보드 복사 |
| **View diff** | commit detail panel 열기 |
| **Revert this commit** | `git revert` (확인 다이얼로그) |
| **Cherry-pick to...** | branch 선택 후 `git cherry-pick` |

### 3.3 Worktree 관리 액션 — 🔶 부분 완료 (dc0a0bc, 2026-02-21)

WorktreeCard 컨텍스트 메뉴 → 에이전트 작업 완료/정리.

| 액션 | 구현 | 설명 |
|---|---|---|
| **Open Terminal** | ✅ | 해당 worktree 터미널로 이동 |
| **Push Branch** | ✅ | 원격에 push |
| **Delete Worktree** | ✅ | worktree 제거 + branch 삭제 (확인 다이얼로그) |
| **Merge to main** | ⬜ | worktree branch → main 머지 + 정리 |

**수정 파일:**
- `src/features/git/components/WorktreeContextMenu.tsx` — 신규 (우클릭 메뉴)
- `src-tauri/src/services/git.rs` — push_branch, remove_worktree 추가
- `src-tauri/src/services/tmux.rs` — worktree 관련 tmux 윈도우 관리

---

## Phase 4: PR & GitHub 연동 (~5h)

### 4.1 PR 뱃지 + 생성

- `gh` CLI 연동으로 branch에 PR 상태 아이콘 표시
- Worktree 컨텍스트 메뉴에서 "Create PR" 지원
- PR 클릭 시 외부 브라우저에서 열기

### 4.2 커밋 검색/필터

- 커밋 메시지 텍스트 검색
- "Agent commits only" 토글
- Branch 필터 드롭다운

---

## 구현 순서 (추천) — 진행 현황

```
Phase 1.1  Worktree → Terminal 네비게이션      ✅ 완료 (379b71c)
Phase 1.2  Branch ↔ Worktree 크로스 하이라이트  ✅ 완료 (379b71c)
Phase 3.1  New Agent Task 버튼                 ✅ 완료 (dc0a0bc)
Phase 3.3  Worktree 관리 액션                   🔶 3/4 완료 (dc0a0bc) — Merge to main 미구현
Phase 2.1  Commit Detail Panel                 ✅ 완료
Phase 2.2  Agent Attribution 뱃지              ✅ 완료
Phase 2.5  Working Tree Changes Viewer         ✅ 완료 (2026-02-21)
Phase 2.6  Git Graph 인라인 커밋               ✅ 완료 (2026-02-22)
Phase 3.2  커밋 컨텍스트 메뉴                   ⬜ 미착수
Phase 4.1  PR 뱃지 + 생성                      ⬜ 미착수
Phase 4.2  커밋 검색/필터                       ⬜ 미착수
```

**완료**: Phase 1 전체 + Phase 2 전체 + Phase 2.5 + Phase 2.6 + Phase 3.1 + Phase 3.3 (부분)
**남은 작업**: ~6h (Phase 3.2 커밋 메뉴, Phase 3.3 Merge, Phase 4 전체)
