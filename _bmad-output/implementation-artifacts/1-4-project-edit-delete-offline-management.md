# Story 1.4: 프로젝트 편집, 삭제 & 오프라인 관리

Status: ready-for-dev

## Story

As a 사용자,
I want 프로젝트 설정을 편집하고 삭제할 수 있으며 오프라인에서도 관리가 가능하길,
So that 상황에 맞게 프로젝트를 유연하게 관리할 수 있다.

## Acceptance Criteria

1. **Given** 등록된 프로젝트가 있을 때 **When** 프로젝트 설정 편집을 시작하면 **Then** 이름, 경로, 사용 계정, 기본 프롬프트를 인라인으로 수정할 수 있다 **And** 변경사항이 즉시 저장된다
2. **Given** 사용자가 프로젝트를 삭제할 때 **When** 삭제 버튼을 클릭하면 **Then** 프로젝트가 즉시 삭제되고 5초간 Undo 토스트가 화면 하단에 표시된다 **And** Undo 클릭 시 프로젝트가 복원된다
3. **Given** 네트워크가 연결되지 않은 상태에서 **When** 프로젝트 관리 기능을 사용하면 **Then** 프로젝트 등록/편집/삭제/조회가 정상 동작한다 **And** Claude Code 의존 기능(팀 시작 등)은 비활성화 상태로 표시된다

## Tasks / Subtasks

- [ ] Task 1: Rust 프로젝트 Update/Delete 서비스 (AC: #1, #2)
  - [ ] 1.1: `src-tauri/src/services/project.rs` — `update_project(db, id, fields)` → 부분 업데이트 (name, path, account_id, default_prompt)
  - [ ] 1.2: `src-tauri/src/services/project.rs` — `delete_project(db, id)` → 소프트 삭제 (is_active = 0) 5초 유예
  - [ ] 1.3: `src-tauri/src/services/project.rs` — `restore_project(db, id)` → 복원 (is_active = 1)
  - [ ] 1.4: `src-tauri/src/services/project.rs` — `purge_project(db, id)` → 하드 삭제 (Undo 타임아웃 후)

- [ ] Task 2: Tauri Command 확장 (AC: #1, #2)
  - [ ] 2.1: `src-tauri/src/commands/project.rs` — `update_project` command
  - [ ] 2.2: `src-tauri/src/commands/project.rs` — `delete_project` command (소프트 삭제)
  - [ ] 2.3: `src-tauri/src/commands/project.rs` — `restore_project` command
  - [ ] 2.4: `lib.rs` — invoke_handler에 새 커맨드 등록
  - [ ] 2.5: `src/lib/tauri/commands.ts` — `updateProject()`, `deleteProject()`, `restoreProject()` 래퍼

- [ ] Task 3: 인라인 편집 UI (AC: #1)
  - [ ] 3.1: `src/features/project/components/ProjectEditForm.tsx` — 인라인 편집 폼
    - 카드 클릭 또는 편집 아이콘 → 인라인 편집 모드 전환
    - 이름: contentEditable 또는 Input 전환
    - 경로: 변경 버튼 → Tauri dialog
    - 기본 프롬프트: textarea (접히기/펼치기)
  - [ ] 3.2: 변경 즉시 저장 (debounce 300ms) — 옵티미스틱 UI
  - [ ] 3.3: 저장 실패 시 원래 값으로 롤백 + 에러 토스트

- [ ] Task 4: Undo 토스트 시스템 (AC: #2)
  - [ ] 4.1: `src/components/ui/UndoToast.tsx` — 범용 Undo 토스트 컴포넌트
    - slide-up + fade 애니메이션 (300ms in, 200ms out)
    - 5초 자동 해제 타이머
    - 하단 중앙 고정
    - "[메시지] — [되돌리기] [닫기]"
  - [ ] 4.2: `src/stores/appStore.ts` — toast 상태 관리 (queue 패턴)
  - [ ] 4.3: 삭제 흐름: 즉시 UI 제거 → 토스트 표시 → 5초 후 purge / Undo 시 restore

- [ ] Task 5: 네트워크 상태 감지 & 오프라인 관리 (AC: #3)
  - [ ] 5.1: `src/stores/networkStore.ts` — 네트워크 상태 Zustand store
    - `navigator.onLine` + `online`/`offline` 이벤트 리스너
    - `isOnline: boolean`
  - [ ] 5.2: 오프라인 시 Claude 의존 기능 비활성화 표시
    - ProjectCard: Start 버튼 disabled + 툴팁 "오프라인 — 네트워크 연결 필요"
    - StatusBar: "오프라인" 인디케이터
  - [ ] 5.3: 프로젝트 CRUD는 SQLite 로컬이므로 오프라인에서도 정상 동작 (별도 처리 불필요)

- [ ] Task 6: projectStore 확장 (AC: #1, #2)
  - [ ] 6.1: `src/features/project/stores/projectStore.ts` — updateProject, deleteProject, restoreProject 액션 추가
  - [ ] 6.2: 옵티미스틱 업데이트: 즉시 로컬 상태 변경 → 백엔드 호출 → 실패 시 롤백
  - [ ] 6.3: 삭제 시: projects 배열에서 즉시 제거 + pendingDelete Map에 보관 (5초 Undo 용)

- [ ] Task 7: 테스트 & 검증 (AC: #1, #2, #3)
  - [ ] 7.1: Rust 단위 테스트 — update_project, delete_project, restore_project 서비스 테스트
  - [ ] 7.2: 인라인 편집 → 즉시 저장 → 새로고침 후 유지 확인
  - [ ] 7.3: 삭제 → Undo 토스트 → 되돌리기 확인
  - [ ] 7.4: 오프라인 상태에서 CRUD 정상 동작 확인

## Dev Notes

### 아키텍처 패턴 & 제약사항

**CRITICAL — 반드시 따를 것:**

1. **소프트 삭제 패턴:**
   - 즉시 `is_active = 0`으로 업데이트 (DB에서 제거하지 않음)
   - 5초 Undo 윈도우 후 하드 삭제 (실제 DELETE)
   - `list_projects`는 `WHERE is_active = 1` 조건
   - Undo 중 다른 사용자 액션 허용 (논블로킹)

2. **Undo Toast UX 스펙:**
   - 위치: 화면 하단 중앙
   - 애니메이션: slide-up + fade (300ms in, 200ms out)
   - 지속: 5초 → 자동 해제
   - 포맷: "[프로젝트명] 삭제됨 — [되돌리기]"
   - **확인 대화상자 금지** — 즉시 삭제 + Undo 제공

3. **인라인 편집 패턴:**
   - 모달/페이지 전환 없음 — 현재 위치에서 편집
   - debounce 300ms 후 자동 저장
   - 저장 중 스피너 없음 (옵티미스틱)
   - 실패 시만 롤백 + 에러 표시

4. **네트워크 상태 관리:**
   ```typescript
   // stores/networkStore.ts
   interface NetworkState {
     isOnline: boolean;
     // Actions
     initNetworkListener: () => () => void; // cleanup 함수 반환
   }
   ```
   - `navigator.onLine` 초기값 + `online`/`offline` 이벤트
   - Claude 의존 기능: 팀 시작/중지 (Epic 3), 인증 확인 (Epic 5)
   - 이 스토리에서는 비활성 표시만 (기능은 후속 스토리)

5. **UpdateProject 입력:**
   ```rust
   #[derive(Debug, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct UpdateProjectInput {
       pub name: Option<String>,
       pub path: Option<String>,
       pub account_id: Option<String>,
       pub default_prompt: Option<String>,
   }
   ```
   - Option 필드: None이면 업데이트하지 않음
   - updated_at 자동 갱신: `datetime('now')`

### Story 1.1/1.3 인텔리전스 (이전 스토리 학습)

- **DB 패턴:** `conn.execute()` + `params![]` (rusqlite 매크로)
- **옵티미스틱 UI:** Zustand에서 즉시 상태 변경, 백엔드 호출은 비동기
- **컬러 바:** ProjectCard의 좌측 4px — color_index로 팔레트 참조
- **bun 사용:** 새 패키지 설치 시 `bun add ...`

### Project Structure Notes

- `src/features/project/components/ProjectEditForm.tsx` — 신규
- `src/components/ui/UndoToast.tsx` — 범용 컴포넌트 (다른 스토리에서도 재사용)
- `src/stores/networkStore.ts` — 전역 네트워크 상태
- `src-tauri/src/services/project.rs` — update/delete/restore 추가

### References

- [Source: architecture.md#Process Patterns] — 에러 핸들링, 로딩 상태
- [Source: ux-design-specification.md#Optimistic UI] — 즉시 반응, 실패 시 롤백
- [Source: ux-design-specification.md#Undo Toast] — 5초, 하단 중앙, 슬라이드 업
- [Source: ux-design-specification.md#Button Hierarchy] — Destructive(Rose) 삭제 버튼
- [Source: ux-design-specification.md#Feedback Patterns] — 에러 메시지 구조
- [Source: ux-design-specification.md#Inline Edit] — 모달 아닌 인라인
- [Source: epics.md#Story 1.4] — Acceptance Criteria 원문
- [Source: prd.md#FR3, FR4, FR32, FR33] — 편집, 삭제, 오프라인 CRUD

## Dev Agent Record

### Agent Model Used

(개발 시 기록)

### Debug Log References

### Completion Notes List

### Change Log

### File List
