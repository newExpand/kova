# Story 1.3: 프로젝트 등록 & 카드 대시보드

Status: ready-for-dev

## Story

As a 사용자,
I want 로컬 프로젝트를 등록하고 카드 대시보드에서 모든 프로젝트를 한눈에 볼 수 있길,
So that 여러 프로젝트를 시각적으로 관리할 수 있다.

## Acceptance Criteria

1. **Given** 사용자가 대시보드에서 프로젝트 등록을 시작할 때 **When** 디렉토리를 선택하고 프로젝트 이름을 입력하면 **Then** 프로젝트가 SQLite에 저장되고 대시보드에 카드로 즉시 표시된다
2. **Given** 등록된 프로젝트가 3개 이상 있을 때 **When** 대시보드를 조회하면 **Then** 500ms 이내에 모든 프로젝트가 카드 그리드(2~3열)로 표시된다 **And** 각 카드에 프로젝트명, 경로, 상태(활성/비활성/에러), 프로젝트 컬러 바(4px 좌측)가 표시된다
3. **Given** 프로젝트 디렉토리가 존재하지 않을 때 **When** 대시보드에 프로젝트 상태가 표시되면 **Then** 해당 프로젝트 카드에 에러 상태(Rose)가 표시된다
4. **Given** 사이드바가 표시될 때 **When** 프로젝트 목록을 확인하면 **Then** 각 프로젝트가 컬러 도트 + 이름 + 상태 인디케이터로 표시된다

## Tasks / Subtasks

- [ ] Task 1: Rust 프로젝트 CRUD 서비스 (AC: #1, #2, #3)
  - [ ] 1.1: `src-tauri/src/services/project.rs` — `create_project(db, name, path)` → UUID 생성, color_index 자동 할당
  - [ ] 1.2: `src-tauri/src/services/project.rs` — `list_projects(db)` → 전체 프로젝트 조회, 디렉토리 존재 여부 확인
  - [ ] 1.3: `src-tauri/src/services/project.rs` — `get_project(db, id)` → 단일 프로젝트 조회
  - [ ] 1.4: 프로젝트 등록 시 디렉토리 경로 유효성 검증 (존재, 읽기 권한)
  - [ ] 1.5: color_index 자동 순환 할당 (0~7, 기존 프로젝트 수 % 8)

- [ ] Task 2: Tauri Command & IPC 연결 (AC: #1, #2)
  - [ ] 2.1: `src-tauri/src/commands/project.rs` — `create_project` command (name: String, path: String)
  - [ ] 2.2: `src-tauri/src/commands/project.rs` — `list_projects` command → Vec<Project>
  - [ ] 2.3: `src-tauri/src/commands/project.rs` — `get_project` command (id: String)
  - [ ] 2.4: `lib.rs` — invoke_handler에 새 커맨드 등록
  - [ ] 2.5: `src/lib/tauri/commands.ts` — `createProject()`, `listProjects()`, `getProject()` 래퍼

- [ ] Task 3: Tauri 디렉토리 선택 다이얼로그 (AC: #1)
  - [ ] 3.1: `src-tauri/Cargo.toml` — `tauri-plugin-dialog` 추가
  - [ ] 3.2: `src-tauri/tauri.conf.json` — dialog 플러그인 권한 설정
  - [ ] 3.3: `lib.rs` — `.plugin(tauri_plugin_dialog::init())` 등록
  - [ ] 3.4: 프론트엔드에서 `@tauri-apps/plugin-dialog` 의 `open()` 사용 → 디렉토리 선택

- [ ] Task 4: 프론트엔드 ProjectCard 컴포넌트 (AC: #2, #3)
  - [ ] 4.1: `src/features/project/types.ts` — Project, ProjectStatus 타입 정의
  - [ ] 4.2: `src/features/project/components/ProjectCard.tsx` — 카드 UI
    - 프로젝트 컬러 바 (좌측 4px, 8색 팔레트)
    - 프로젝트명 (H2, 16px Medium)
    - 경로 (Mono 13px, 말줄임)
    - StatusIndicator (Idle/Error)
    - role="article", aria-label
  - [ ] 4.3: `src/features/project/components/StatusIndicator.tsx` — 상태 아이콘+텍스트+컬러
  - [ ] 4.4: 카드 hover: Surface 3 배경, scale(1.01) + shadow (100ms)

- [ ] Task 5: 프론트엔드 ProjectGrid & 대시보드 (AC: #2)
  - [ ] 5.1: `src/features/project/components/ProjectGrid.tsx` — 반응형 그리드 (2~4열)
    - CSS Grid: `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))`
    - gap: 16px (lg)
  - [ ] 5.2: `src/features/project/stores/projectStore.ts` — Zustand store (프로젝트 목록, CRUD actions)
  - [ ] 5.3: `src/features/project/hooks/useProjects.ts` — 프로젝트 목록 fetch 훅 (앱 마운트 시 자동 로드)
  - [ ] 5.4: 빈 상태 UI: "첫 프로젝트를 등록하세요" + [프로젝트 등록] Primary 버튼

- [ ] Task 6: 프로젝트 등록 폼 (AC: #1)
  - [ ] 6.1: `src/features/project/components/ProjectForm.tsx` — Dialog 모달 (생성 전용)
    - 프로젝트 이름 Input
    - 디렉토리 선택 버튼 (Tauri dialog)
    - [등록] Primary 버튼, [취소] Secondary 버튼
  - [ ] 6.2: 실시간 유효성 검증: 이름 필수, 경로 필수, 중복 이름 경고
  - [ ] 6.3: 등록 성공 시 모달 닫기 + 카드 즉시 추가 (옵티미스틱 UI)

- [ ] Task 7: 사이드바 프로젝트 목록 연동 (AC: #4)
  - [ ] 7.1: `src/components/layout/Sidebar.tsx` 수정 — projectStore 구독
  - [ ] 7.2: 각 프로젝트: 컬러 도트(8px 원) + 이름 + 상태 인디케이터
  - [ ] 7.3: 선택된 프로젝트 하이라이트 (Surface 3 배경)
  - [ ] 7.4: 사이드바 하단: [+ 프로젝트 등록] 버튼

- [ ] Task 8: 디렉토리 존재 여부 체크 & 에러 상태 (AC: #3)
  - [ ] 8.1: `list_projects` 시 각 프로젝트의 path 존재 여부 확인 (`std::path::Path::exists()`)
  - [ ] 8.2: 존재하지 않는 경로 → 프로젝트 상태를 "error"로 표시, 에러 메시지 포함
  - [ ] 8.3: ProjectCard에서 error 상태 시 Rose 좌측 바 + 에러 메시지

- [ ] Task 9: 테스트 & 검증 (AC: #1, #2, #3, #4)
  - [ ] 9.1: Rust 단위 테스트 — create_project, list_projects 서비스 테스트
  - [ ] 9.2: 앱 실행 후 프로젝트 등록 → 카드 표시 → 사이드바 연동 확인
  - [ ] 9.3: 존재하지 않는 경로 프로젝트 → 에러 카드 표시 확인

## Dev Notes

### 아키텍처 패턴 & 제약사항

**CRITICAL — 반드시 따를 것:**

1. **프로젝트 컬러 팔레트 (8색):**
   | Index | Name | Hex |
   |-------|------|-----|
   | 0 | Sky | #38BDF8 |
   | 1 | Violet | #8B5CF6 |
   | 2 | Emerald | #34D399 |
   | 3 | Amber | #FBBF24 |
   | 4 | Rose | #FB7185 |
   | 5 | Cyan | #22D3EE |
   | 6 | Orange | #FB923C |
   | 7 | Lime | #A3E635 |

2. **ProjectCard 구조:**
   ```
   ┌─ ProjectCard ─────────────────────────────┐
   │ 🟣 [4px Color Bar]                         │
   │ ┌───────────────────────────────────────┐  │
   │ │ Project Name           StatusIndicator│  │
   │ │ ~/path/to/project      [비활성 ○]     │  │
   │ └───────────────────────────────────────┘  │
   └────────────────────────────────────────────┘
   ```
   - MVP: Start/Stop 버튼은 Story 3.1에서 추가
   - 이 스토리에서는 Idle/Error 상태만 표시

3. **StatusIndicator 상태 (이 스토리 범위):**
   | Status | Color | Icon | Text |
   |--------|-------|------|------|
   | Idle | Zinc-500 | ○ | 비활성 |
   | Error | Rose | ✕ | 경로 없음 |

4. **Zustand projectStore 패턴:**
   ```typescript
   interface ProjectState {
     projects: Project[];
     selectedProjectId: string | null;
     isLoading: boolean;
     // Actions
     fetchProjects: () => Promise<void>;
     createProject: (name: string, path: string) => Promise<void>;
     selectProject: (id: string) => void;
   }
   ```
   - devtools 미들웨어 필수
   - subscribeWithSelector로 사이드바 구독

5. **Tauri Dialog Plugin:**
   - `bun add @tauri-apps/plugin-dialog`
   - Rust: `cargo add tauri-plugin-dialog`
   - capabilities/default.json에 `"dialog:default"` 추가

6. **성능 요구사항:**
   - 프로젝트 목록 로드 < 500ms (NFR7)
   - 옵티미스틱 UI: 등록 클릭 즉시 카드 추가, 실패 시 롤백

### Story 1.1 인텔리전스 (이전 스토리 학습)

- **DB 접근 패턴:** `db.conn.lock().map_err(|e| AppError::Internal(...))` → `?` 사용
- **파라미터 바인딩:** `conn.execute("INSERT ... VALUES (?1, ?2, ...)", params![...])` — SQL 인젝션 방지
- **UUID 생성:** `uuid::Uuid::new_v4().to_string()` (Cargo.toml에 uuid 이미 있음)
- **bun 사용:** `bun add @tauri-apps/plugin-dialog`
- **패키지 매니저:** tauri.conf.json의 beforeDevCommand/beforeBuildCommand에 `bun run` 사용

### Project Structure Notes

- `src/features/project/` — components/, hooks/, stores/, types.ts, index.ts
- `src-tauri/src/services/project.rs` — 비즈니스 로직
- `src-tauri/src/commands/project.rs` — 기존 health_check에 CRUD 커맨드 추가
- 기존 `models/project.rs`의 Project struct 재사용

### References

- [Source: architecture.md#Data Architecture] — rusqlite, 코드 우선 모델링
- [Source: architecture.md#Structure Patterns] — feature 코로케이션
- [Source: architecture.md#Communication Patterns] — Zustand Store 패턴
- [Source: ux-design-specification.md#ProjectCard] — 카드 anatomy, 상태, 접근성
- [Source: ux-design-specification.md#Project Identification Palette] — 8색 팔레트
- [Source: ux-design-specification.md#Grid Layout] — 반응형 2~4열
- [Source: ux-design-specification.md#Empty States] — "첫 프로젝트를 등록하세요"
- [Source: ux-design-specification.md#Button Hierarchy] — Primary/Secondary 버튼 규칙
- [Source: epics.md#Story 1.3] — Acceptance Criteria 원문
- [Source: prd.md#FR1~FR5] — 프로젝트 CRUD, 상태 표시

## Dev Agent Record

### Agent Model Used

(개발 시 기록)

### Debug Log References

### Completion Notes List

### Change Log

### File List
