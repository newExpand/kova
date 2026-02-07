# Project CRUD Agent Integration Notes

**Agent**: project-crud
**Stories**: 1.3 (Project Registration & Card Dashboard) + 1.4 (Project Edit, Delete & Offline Management)
**Date**: 2026-02-07

---

## ✅ 완료된 작업

### Rust 백엔드

#### 서비스 (`src-tauri/src/services/project.rs`)
- ✅ `create_project(conn, name, path)` — UUID v4 생성, 색상 인덱스 자동 할당 (0-7 순환), 디렉토리 존재 확인
- ✅ `list_projects(conn)` — is_active = 1인 프로젝트만 조회, DESC 정렬
- ✅ `get_project(conn, id)` — 단일 프로젝트 조회
- ✅ `update_project(conn, id, input)` — 부분 업데이트, 경로 변경 시 존재 확인
- ✅ `delete_project(conn, id)` — 소프트 삭제 (is_active = 0)
- ✅ `restore_project(conn, id)` — 삭제된 프로젝트 복원
- ✅ `purge_project(conn, id)` — 하드 삭제 (물리적 제거)
- ✅ Rust 단위 테스트 8개 작성 (색상 순환, 업데이트, 삭제/복원, 에러 케이스 등)

#### 커맨드 (`src-tauri/src/commands/project.rs`)
- ✅ `create_project` — 프로젝트 생성 command
- ✅ `list_projects` — 프로젝트 목록 조회 command
- ✅ `get_project` — 단일 프로젝트 조회 command
- ✅ `update_project` — 프로젝트 수정 command
- ✅ `delete_project` — 소프트 삭제 command
- ✅ `restore_project` — 복원 command
- ✅ `purge_project` — 하드 삭제 command

### 프론트엔드

#### 타입 (`src/features/project/types.ts`)
- ✅ `Project` 인터페이스 (camelCase로 매핑)
- ✅ `ProjectStatus` 타입 (idle, running, error)
- ✅ `CreateProjectInput` 인터페이스
- ✅ `UpdateProjectInput` 인터페이스 (부분 업데이트용)
- ✅ `COLOR_PALETTE` 상수 (8색)
- ✅ `getProjectColor()` 헬퍼 함수

#### Store (`src/features/project/stores/projectStore.ts`)
- ✅ Zustand store with devtools
- ✅ Optimistic UI 패턴 (addProjectOptimistic, rollbackOptimistic, confirmOptimistic)
- ✅ Story 1.4: pendingDelete Map (5초 undo 윈도우)
- ✅ `updateProject`, `markForDeletion`, `cancelDeletion`, `confirmDeletion` actions

#### 컴포넌트
- ✅ `StatusIndicator` — 상태 아이콘 + 텍스트 + 색상
- ✅ `ProjectCard` — 4px 색상 바, 이름/경로, hover 효과
- ✅ `ProjectGrid` — CSS Grid (auto-fill, minmax(300px, 1fr))
- ✅ `ProjectForm` — 등록 Dialog (이름 + 경로 선택)
- ✅ `ProjectEditForm` — 인라인 편집 (300ms 디바운스 자동 저장)

#### Hooks (`src/features/project/hooks/useProjects.ts`)
- ✅ `useProjects` — loadProjects, createProject, updateProject, deleteProject, restoreProject
- ✅ Optimistic updates with rollback

#### UI 공통 컴포넌트
- ✅ `src/components/ui/Input.tsx` — 입력 필드
- ✅ `src/components/ui/Label.tsx` — 라벨
- ✅ `src/components/ui/UndoToast.tsx` — Undo 토스트 (슬라이드 업 애니메이션, 5초 자동 닫힘)

#### Store (전역)
- ✅ `src/stores/networkStore.ts` — 온라인/오프라인 상태 모니터링

---

## 🔧 Lead가 통합해야 할 사항

### 1. Rust 모듈 등록

#### `src-tauri/src/services/mod.rs`
```rust
pub mod environment;
pub mod project;  // 추가 필요
```

### 2. Tauri Command 등록

#### `src-tauri/src/lib.rs`
`invoke_handler!` 매크로에 다음 commands 추가:
```rust
.invoke_handler(tauri::generate_handler![
    commands::project::health_check,
    commands::project::create_project,       // 추가
    commands::project::list_projects,        // 추가
    commands::project::get_project,          // 추가
    commands::project::update_project,       // 추가
    commands::project::delete_project,       // 추가
    commands::project::restore_project,      // 추가
    commands::project::purge_project,        // 추가
    commands::environment::check_environment,
    commands::environment::recheck_environment,
])
```

### 3. 프론트엔드 Tauri Command 래퍼

#### `src/lib/tauri/commands.ts`
Specta로 생성된 TS 타입과 함수를 import하여 사용하도록 래퍼 추가:
```typescript
// Project commands
export async function createProject(name: string, path: string): Promise<string> {
  return await invoke('create_project', { name, path });
}

export async function listProjects(): Promise<Project[]> {
  return await invoke('list_projects');
}

export async function getProject(id: string): Promise<Project | null> {
  return await invoke('get_project', { id });
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  return await invoke('update_project', { id, input });
}

export async function deleteProject(id: string): Promise<void> {
  return await invoke('delete_project', { id });
}

export async function restoreProject(id: string): Promise<Project> {
  return await invoke('restore_project', { id });
}

export async function purgeProject(id: string): Promise<void> {
  return await invoke('purge_project', { id });
}
```

**주의**: 현재 `useProjects` 훅에서는 임시로 `invoke`를 직접 호출하고 있으므로, 위 래퍼 추가 후 다음 파일 수정 필요:
- `src/features/project/hooks/useProjects.ts` — import 경로를 `@tauri-apps/api/core`에서 `@/lib/tauri/commands`로 변경

### 4. Cargo.toml 의존성

#### `src-tauri/Cargo.toml`
`[dependencies]` 섹션에 추가:
```toml
uuid = { version = "1.10", features = ["v4", "serde"] }  # UUID v4 생성용
```

**주의**: `serde`, `rusqlite`, `tracing` 등은 이미 있는 것으로 가정.

### 5. NPM 의존성

#### `package.json`
```json
{
  "dependencies": {
    "@tauri-apps/plugin-dialog": "^2.0.0",  // 디렉토리 선택 dialog
    "@radix-ui/react-label": "^2.0.0",      // Label 컴포넌트용
    "lucide-react": "latest",                // 아이콘 (Folder, Trash2, X, Circle, PlayCircle, AlertCircle)
    "zustand": "^5.0.10"                     // 이미 있을 가능성 있음
  }
}
```

**Tauri Plugin 추가** (`src-tauri/Cargo.toml`):
```toml
[dependencies]
tauri-plugin-dialog = "2"
```

**Tauri Plugin 등록** (`src-tauri/src/lib.rs`):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())  // 추가
    .plugin(tauri_plugin_log::Builder::default()...
```

### 6. Route 추가 (옵션)

Story 1.3/1.4에서는 대시보드 페이지 자체는 구현하지 않았으나, 컴포넌트는 모두 준비됨.

#### `src/app/routes.tsx`에 추가 예시:
```tsx
import { ProjectGrid, ProjectCard, ProjectForm, useProjects } from '@/features/project';

function ProjectDashboardPage() {
  const { projects, isLoading, createProject } = useProjects();

  if (isLoading) return <div>로딩 중...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between mb-6">
        <h1 className="text-2xl font-bold">프로젝트</h1>
        <ProjectForm
          trigger={<button>새 프로젝트</button>}
          onSubmit={createProject}
        />
      </div>
      {projects.length === 0 ? (
        <p>첫 프로젝트를 등록하세요</p>
      ) : (
        <ProjectGrid>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </ProjectGrid>
      )}
    </div>
  );
}
```

### 7. Sidebar 항목 추가 (옵션)

#### `src/components/layout/Sidebar.tsx`
프로젝트 페이지로 이동하는 링크 추가 예정.

---

## 📝 추가 참고사항

### 에러 처리
- 모든 Rust 함수는 `Result<T, AppError>` 반환 (unwrap 없음)
- 프론트엔드는 try/catch로 에러를 잡아 store의 `setError()` 호출
- 경로가 존재하지 않으면 `AppError::NotFound` 반환

### 색상 팔레트
- 8색 순환: Sky, Violet, Emerald, Amber, Rose, Cyan, Orange, Lime
- `color_index = (현재 프로젝트 수) % 8` 로 자동 할당

### Optimistic UI
- 프로젝트 생성 시 임시 ID로 즉시 UI에 반영, 성공 시 실제 ID로 교체, 실패 시 롤백
- 프로젝트 수정 시 기존 데이터 백업, 실패 시 롤백

### Undo 패턴 (Story 1.4)
- 삭제 시 즉시 UI에서 제거하지만 5초간 undo 가능
- `UndoToast` 컴포넌트로 "되돌리기" 버튼 제공
- 5초 경과 또는 확정 시 실제 soft delete 수행

### 네트워크 상태 (Story 1.4)
- `networkStore`로 온라인/오프라인 감지
- 현재는 준비만 되어 있고, 실제 로직에는 아직 사용하지 않음 (추후 확장 가능)

---

## ⚠️ 알려진 제약사항

1. **Tauri Plugin Dialog 미설치**: 현재 `@tauri-apps/plugin-dialog`가 없어서 디렉토리 선택이 동작하지 않음. Lead가 추가 필요.
2. **Specta 타입 미생성**: `lib/tauri/commands.ts`에 command 래퍼가 없어서, 임시로 `invoke()` 직접 호출 중. Lead가 specta 재생성 후 import 경로 수정 필요.
3. **Route 미연결**: 대시보드 페이지 자체는 구현하지 않음. Lead가 `routes.tsx`에 페이지 추가 필요.

---

## 🧪 테스트 실행

### Rust 테스트
```bash
cargo test --manifest-path src-tauri/Cargo.toml project
```

**예상 결과**: 모든 테스트 통과 (services/mod.rs 통합 후)

### 프론트엔드 테스트
현재 프론트엔드 단위 테스트는 작성되지 않음 (Story 1.3/1.4 scope 밖).

---

## 📦 생성된 파일 목록

### Rust
- `src-tauri/src/services/project.rs` (새로 생성)
- `src-tauri/src/commands/project.rs` (기존 파일 확장)

### TypeScript
- `src/features/project/types.ts`
- `src/features/project/stores/projectStore.ts`
- `src/features/project/hooks/useProjects.ts`
- `src/features/project/components/StatusIndicator.tsx`
- `src/features/project/components/ProjectCard.tsx`
- `src/features/project/components/ProjectGrid.tsx`
- `src/features/project/components/ProjectForm.tsx`
- `src/features/project/components/ProjectEditForm.tsx`
- `src/features/project/index.ts`
- `src/components/ui/Input.tsx`
- `src/components/ui/Label.tsx`
- `src/components/ui/UndoToast.tsx`
- `src/stores/networkStore.ts`

---

**통합 완료 후 team-lead에게 알림 부탁드립니다.**
