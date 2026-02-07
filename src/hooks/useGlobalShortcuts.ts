import { useEffect } from "react";

export interface UseGlobalShortcutsProps {
  onTogglePalette: () => void;
  onNavigateDashboard: () => void;
  onNewProject: () => void;
  onEscape: () => void;
  onSettings?: () => void;
}

/** Input/Textarea 등 텍스트 편집 컨텍스트인지 확인 */
function isEditableElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    el.isContentEditable
  );
}

/**
 * 전역 키보드 단축키 훅
 *
 * - ⌘K → 커맨드 팔레트 토글 (어디서든)
 * - ⌘1 → 대시보드 이동 (편집 컨텍스트 제외)
 * - ⌘N → 새 프로젝트 (어디서든)
 * - ESC → 팔레트 닫기 / 뒤로 가기
 * - ⌘, → 설정 (편집 컨텍스트 제외)
 */
export function useGlobalShortcuts({
  onTogglePalette,
  onNavigateDashboard,
  onNewProject,
  onEscape,
  onSettings,
}: UseGlobalShortcutsProps): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const inEditable = isEditableElement(e.target);

      // ⌘K — 팔레트 토글 (항상 동작)
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        onTogglePalette();
        return;
      }

      // ESC — 닫기 / 뒤로 (항상 동작)
      if (e.key === "Escape") {
        onEscape();
        return;
      }

      // ⌘N — 새 프로젝트 (항상 동작)
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        onNewProject();
        return;
      }

      // 아래 단축키는 편집 컨텍스트에서 무시
      if (inEditable) return;

      // ⌘1 — 대시보드
      if (e.metaKey && e.key === "1") {
        e.preventDefault();
        onNavigateDashboard();
        return;
      }

      // ⌘, — 설정
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        onSettings?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onTogglePalette, onNavigateDashboard, onNewProject, onEscape, onSettings]);
}
