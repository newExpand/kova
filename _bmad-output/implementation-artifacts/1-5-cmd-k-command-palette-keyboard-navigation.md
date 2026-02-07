# Story 1.5: Cmd+K 커맨드 팔레트 & 키보드 네비게이션

Status: ready-for-dev

## Story

As a 파워유저,
I want Cmd+K로 프로젝트를 빠르게 검색하고 키보드로 모든 핵심 액션을 실행하길,
So that 마우스 없이도 효율적으로 앱을 조작할 수 있다.

## Acceptance Criteria

1. **Given** 앱 어디에서든 **When** Cmd+K를 누르면 **Then** 커맨드 팔레트가 오버레이로 표시되고 퍼지 검색이 즉시 동작한다 **And** 결과가 "프로젝트 > 액션 > 설정" 카테고리로 분류된다 **And** 각 항목에 현재 상태 배지가 표시된다
2. **Given** 커맨드 팔레트에서 프로젝트를 선택할 때 **When** Enter를 누르면 **Then** 해당 프로젝트의 상세 뷰로 이동한다
3. **Given** 앱 어디에서든 **When** Cmd+1을 누르면 대시보드로, Cmd+N을 누르면 새 프로젝트 등록으로, ESC를 누르면 이전으로 이동한다

## Tasks / Subtasks

- [ ] Task 1: shadcn/ui Command 컴포넌트 설치 (AC: #1)
  - [ ] 1.1: `bunx shadcn@latest add command` — cmdk 기반 Command 컴포넌트 설치
  - [ ] 1.2: `bunx shadcn@latest add dialog` — Dialog 컴포넌트 (CommandDialog 래퍼)
  - [ ] 1.3: 설치된 컴포넌트가 다크 테마와 호환되는지 확인

- [ ] Task 2: CommandPalette 컴포넌트 구현 (AC: #1, #2)
  - [ ] 2.1: `src/components/layout/CommandPalette.tsx` — Cmd+K 팔레트 UI
    - CommandDialog (오버레이 모달)
    - CommandInput (퍼지 검색)
    - CommandList > CommandGroup (카테고리별 그룹)
  - [ ] 2.2: 검색 카테고리:
    - **프로젝트**: projectStore에서 목록, 컬러 도트 + 이름 + 상태 배지
    - **액션**: "프로젝트 등록", "대시보드로 이동" 등 정적 항목
    - **설정**: "설정 열기" 등
  - [ ] 2.3: 프로젝트 선택 시 → `navigate(`/project/${id}`)` (또는 projectStore.selectProject)
  - [ ] 2.4: 액션 선택 시 → 해당 액션 실행 (라우팅 또는 모달 열기)

- [ ] Task 3: 전역 키보드 단축키 시스템 (AC: #3)
  - [ ] 3.1: `src/hooks/useGlobalShortcuts.ts` — 전역 키보드 이벤트 훅
    - `Cmd+K` → CommandPalette 토글
    - `Cmd+1` → 대시보드 이동 (`/`)
    - `Cmd+N` → 새 프로젝트 등록 (ProjectForm 열기)
    - `ESC` → 팔레트 닫기 / 이전 화면
    - `Cmd+,` → 설정 (placeholder)
  - [ ] 3.2: `src/app/App.tsx`에 `useGlobalShortcuts()` 훅 연결
  - [ ] 3.3: `useEffect` 내 `keydown` 이벤트 리스너 — cleanup 필수
  - [ ] 3.4: 키 충돌 방지: Input/Textarea 포커스 시 Cmd+K/Cmd+N 외 단축키 비활성

- [ ] Task 4: 사이드바 키보드 네비게이션 (AC: #3)
  - [ ] 4.1: `src/components/layout/Sidebar.tsx` — 프로젝트 목록에 ↑/↓ 키 네비게이션
  - [ ] 4.2: `Enter` → 선택된 프로젝트로 이동
  - [ ] 4.3: 포커스 표시: 2px Indigo 포커스 링 (WCAG)
  - [ ] 4.4: `tabindex` + `role="listbox"` + `aria-activedescendant`

- [ ] Task 5: 대시보드 카드 키보드 네비게이션 (AC: #3)
  - [ ] 5.1: ProjectGrid에 `role="grid"`, 각 카드에 `tabindex="0"`
  - [ ] 5.2: `Tab` → 카드 간 이동, `Enter` → 프로젝트 선택
  - [ ] 5.3: 각 카드의 `aria-label="[프로젝트명] - [상태]"`

- [ ] Task 6: CommandPalette 상태 배지 (AC: #1)
  - [ ] 6.1: 검색 결과의 각 프로젝트에 StatusIndicator 소형(sm) 표시
  - [ ] 6.2: 상태별 배지: Idle(Zinc), Running(Emerald), Error(Rose)
  - [ ] 6.3: 단축키 힌트 표시 (오른쪽 끝에 연한 텍스트)

- [ ] Task 7: 접근성 & 모션 처리 (AC: #1, #3)
  - [ ] 7.1: `prefers-reduced-motion` 미디어 쿼리 적용 — 팔레트 애니메이션 제거
  - [ ] 7.2: Focus trapping: CommandPalette 열림 시 팔레트 내부로 포커스 제한
  - [ ] 7.3: 팔레트 닫힘 시 포커스 원래 위치로 복원
  - [ ] 7.4: Skip Link: 첫 Tab에 "메인 콘텐츠로 건너뛰기" 링크

- [ ] Task 8: 테스트 & 검증 (AC: #1, #2, #3)
  - [ ] 8.1: Cmd+K → 팔레트 열림 → 검색 → Enter → 프로젝트 이동 확인
  - [ ] 8.2: Cmd+1 → 대시보드, Cmd+N → 등록 폼, ESC → 뒤로 가기 확인
  - [ ] 8.3: 키보드만으로 전체 네비게이션 가능 확인

## Dev Notes

### 아키텍처 패턴 & 제약사항

**CRITICAL — 반드시 따를 것:**

1. **cmdk (Command Menu) 패턴:**
   - shadcn/ui의 `Command` 컴포넌트 사용 (cmdk 기반)
   - `CommandDialog` = Dialog + Command 조합
   - 퍼지 검색은 cmdk 내장 기능 사용
   - **공유 UI이므로** `src/components/layout/CommandPalette.tsx`에 위치

2. **키보드 단축키 맵:**
   | 단축키 | 액션 | 컨텍스트 |
   |--------|------|---------|
   | `⌘+K` | 커맨드 팔레트 열기/닫기 | 전역 |
   | `⌘+1` | 대시보드 이동 | 전역 |
   | `⌘+N` | 새 프로젝트 등록 | 전역 |
   | `ESC` | 뒤로 가기 / 팔레트 닫기 | 전역 |
   | `⌘+,` | 설정 | 전역 |
   | `↑/↓` | 목록 네비게이션 | 리스트, 팔레트 |
   | `Enter` | 선택 실행 | 리스트, 팔레트 |

3. **3-Level Drill-Down 네비게이션:**
   | 액션 | 방법 |
   |------|------|
   | 깊이 이동 | 카드 클릭 또는 Enter |
   | 뒤로 이동 | ESC 또는 뒤로 버튼 |
   | 최상위 복귀 | ⌘+1 |
   | 교차 이동 | ⌘+K → 프로젝트 선택 |

4. **이벤트 핸들링 주의사항:**
   - `e.metaKey` (macOS Cmd) 체크
   - `e.preventDefault()` 필수 (브라우저 기본 동작 차단)
   - Input/Textarea 내에서는 일부 단축키 비활성 (`Cmd+K`, `Cmd+N`, `ESC`는 항상 동작)
   - `useCallback` + `useEffect` cleanup 패턴

5. **접근성 필수 사항:**
   - 모든 인터랙티브 요소: 2px Indigo 포커스 링
   - `aria-label` 모든 버튼/링크
   - `aria-live="polite"` 상태 변경 영역
   - 포커스 이동: 레벨 전환 시 새 뷰의 첫 인터랙티브 요소로
   - Skip Link: `<a href="#main-content">메인 콘텐츠로 건너뛰기</a>`

### Story 1.1~1.3 인텔리전스

- **projectStore:** Story 1.3에서 생성됨 — projects 배열, selectProject 액션 사용
- **React Router:** Story 1.1에서 BrowserRouter 설정 완료 — `useNavigate()` 사용
- **사이드바:** Story 1.1에서 Sidebar 컴포넌트 생성, Story 1.3에서 프로젝트 목록 연동
- **shadcn/ui:** Story 1.1에서 init 완료, Dialog 추가 설치 필요 (`bunx shadcn@latest add dialog command`)

### Project Structure Notes

- `src/components/layout/CommandPalette.tsx` — 공유 레이아웃 컴포넌트
- `src/hooks/useGlobalShortcuts.ts` — 전역 훅 (app 레벨)
- `src/components/ui/command.tsx` — shadcn 생성 (cmdk)
- `src/components/ui/dialog.tsx` — shadcn 생성

### References

- [Source: architecture.md#Frontend Architecture] — React Router, feature 코로케이션
- [Source: ux-design-specification.md#Cmd+K Command Palette] — 팔레트 스펙
- [Source: ux-design-specification.md#Keyboard Shortcut System] — 단축키 전체 맵
- [Source: ux-design-specification.md#3-Level Drill-Down] — 네비게이션 구조
- [Source: ux-design-specification.md#Accessibility Requirements] — WCAG 2.1 AA
- [Source: ux-design-specification.md#Focus Management] — 포커스 링, 트래핑
- [Source: ux-design-specification.md#Motion Accessibility] — prefers-reduced-motion
- [Source: epics.md#Story 1.5] — Acceptance Criteria 원문
- [Source: prd.md#FR34] — Cmd+K 커맨드 팔레트

## Dev Agent Record

### Agent Model Used

(개발 시 기록)

### Debug Log References

### Completion Notes List

### Change Log

### File List
