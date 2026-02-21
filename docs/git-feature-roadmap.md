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

## Phase 2: 커밋 상세 & Agent Attribution (~4h)

> 커밋을 클릭하면 에이전트가 뭘 했는지 한눈에 볼 수 있게 한다.

### 2.1 Commit Detail Panel

커밋 선택 시 하단 패널에 diff + 에이전트 정보 표시.
- 커밋 메타데이터 (author, date, full message)
- `Co-Authored-By: Claude` 감지 시 "Agent Commit" 뱃지
- 변경 통계 (`+N -M, K files changed`)
- 파일별 diff (collapsible, 줄별 색상 하이라이팅)

### 2.2 Agent Attribution 표시

커밋 리스트에서 에이전트가 만든 커밋을 시각적으로 구분.
- `Co-Authored-By: Claude` 패턴 감지
- 해당 커밋 행에 에이전트 뱃지 추가

---

## Phase 3: 에이전트 워크플로우 액션 (~6h)

> git graph를 "관제탑"으로 만드는 핵심 기능.

### 3.1 "New Agent Task" 버튼

WorktreePanel 헤더에 "+" 버튼 → 새 에이전트 태스크 원클릭 시작.
- 태스크 이름 입력 + base branch 선택
- worktree 생성 → tmux 세션 생성 → Claude 시작 → 터미널 이동

### 3.2 커밋 컨텍스트 메뉴

커밋 우클릭 → 에이전트 관련 액션 메뉴.

| 액션 | 설명 |
|---|---|
| **Copy hash** | 클립보드 복사 |
| **View diff** | commit detail panel 열기 |
| **Revert this commit** | `git revert` (확인 다이얼로그) |
| **Cherry-pick to...** | branch 선택 후 `git cherry-pick` |

### 3.3 Worktree 관리 액션

WorktreeCard 컨텍스트 메뉴 → 에이전트 작업 완료/정리.

| 액션 | 설명 |
|---|---|
| **Open Terminal** | 해당 worktree 터미널로 이동 |
| **Merge to main** | worktree branch → main 머지 + 정리 |
| **Delete worktree** | worktree 제거 + branch 삭제 |
| **Push branch** | 원격에 push |

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

## 구현 순서 (추천)

```
Phase 1.1  Worktree → Terminal 네비게이션      ~1h  ✅ 완료
Phase 1.2  Branch ↔ Worktree 크로스 하이라이트  ~2h  ✅ 완료
Phase 2.1  Commit Detail Panel                 ~4h
Phase 2.2  Agent Attribution 뱃지              ~1h
Phase 3.1  New Agent Task 버튼                 ~3h
Phase 3.2  커밋 컨텍스트 메뉴                   ~2h
Phase 3.3  Worktree 관리 액션                   ~2h
Phase 4.1  PR 뱃지 + 생성                      ~4h
Phase 4.2  커밋 검색/필터                       ~2h
```

**총 예상**: ~21h
