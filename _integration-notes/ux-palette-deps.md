# UX Palette Integration Notes

## 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/components/layout/CommandPalette.tsx` | CommandPalette, SkipLink, getCardA11yProps |
| `src/hooks/useGlobalShortcuts.ts` | 전역 키보드 단축키 훅 |
| `src/components/ui/command.tsx` | shadcn Command (자동 생성) |
| `src/components/ui/dialog.tsx` | shadcn Dialog (자동 생성) |
| `src/components/ui/button.tsx` | shadcn Button (dialog 의존성) |

## 1. CommandPalette를 PageLayout 또는 App.tsx에 연결

```tsx
// App.tsx 또는 routes.tsx에서:
import { useState, useCallback } from "react";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

// AppRoutes 내부에서:
const [paletteOpen, setPaletteOpen] = useState(false);

useGlobalShortcuts({
  onTogglePalette: () => setPaletteOpen((prev) => !prev),
  onNavigateDashboard: () => navigate("/"),
  onNewProject: () => { /* 새 프로젝트 로직 */ },
  onEscape: () => setPaletteOpen(false),
  onSettings: () => { /* 설정 페이지 */ },
});

// JSX:
<CommandPalette
  open={paletteOpen}
  onOpenChange={setPaletteOpen}
  projects={[]} // projectStore에서 가져올 프로젝트 목록
  onSelectProject={(id) => navigate(`/project/${id}`)}
  onAction={(action) => {
    switch (action) {
      case "new-project": /* 새 프로젝트 */ break;
      case "navigate-dashboard": navigate("/"); break;
      case "open-settings": /* 설정 */ break;
    }
  }}
/>
```

## 2. useGlobalShortcuts 연결

`useGlobalShortcuts`는 BrowserRouter 내부에서 호출해야 `navigate()`를 사용할 수 있음.
`AppRoutes` 컴포넌트 내부에서 호출하는 것을 권장.

## 3. appStore 추가 사항 (선택)

상태를 appStore에서 관리하고 싶다면:

```typescript
// appStore.ts에 추가:
interface AppState {
  // ... 기존 ...
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}
```

또는 단순히 로컬 state (`useState`)로 관리해도 됨. 다른 컴포넌트에서 팔레트를 열 필요가 없다면 로컬 state 추천.

## 4. SkipLink 통합

```tsx
// PageLayout.tsx에서:
import { SkipLink } from "@/components/layout/CommandPalette";

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <SkipLink />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-surface-base">
          {children}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
```

주의: `<main>` 태그에 `id="main-content"`와 `tabIndex={-1}` 추가 필요.

## 5. CommandPalette Props 참조

```typescript
interface CommandPaletteProps {
  open: boolean;                                    // 팔레트 열림 상태
  onOpenChange: (open: boolean) => void;           // 열림 상태 변경
  projects?: Array<{                               // 프로젝트 목록
    id: string;
    name: string;
    colorIndex: number;                            // 0-7 (8색 팔레트)
    status: string;                                // "idle" | "running" | "error"
  }>;
  onSelectProject?: (id: string) => void;          // 프로젝트 선택 시
  onAction?: (action: string) => void;             // 액션 선택 시
}
// action 값: "new-project" | "navigate-dashboard" | "open-settings"
```

## 6. getCardA11yProps 사용법

```tsx
import { getCardA11yProps } from "@/components/layout/CommandPalette";

// ProjectCard에서:
<div {...getCardA11yProps(project.name, project.status)}>
  {/* 카드 내용 */}
</div>
```

## 7. 설치된 의존성

shadcn add로 자동 설치된 패키지:
- `cmdk` — Command Menu Kit (퍼지 검색, 키보드 네비게이션)
- `radix-ui` 관련 (이미 있던 의존성)

## 8. prefers-reduced-motion

`src/index.css` 하단에 추가됨:
```css
@media (prefers-reduced-motion: reduce) {
  [data-slot="dialog-overlay"],
  [data-slot="dialog-content"] {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
}
```
