import { useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/features/project';
import { getProjectColor } from '@/features/project';
import type { ProjectStatus } from '@/features/project';
import { STATUS_LABELS } from '@/features/project';

export function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);

  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (projects.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = activeIndex < projects.length - 1 ? activeIndex + 1 : 0;
        setActiveIndex(nextIndex);
        selectProject(projects[nextIndex].id);
        // 포커스를 해당 항목으로 이동
        const items = listRef.current?.querySelectorAll('[role="option"]');
        (items?.[nextIndex] as HTMLElement)?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = activeIndex > 0 ? activeIndex - 1 : projects.length - 1;
        setActiveIndex(prevIndex);
        selectProject(projects[prevIndex].id);
        const items = listRef.current?.querySelectorAll('[role="option"]');
        (items?.[prevIndex] as HTMLElement)?.focus();
        break;
      }
      case 'Home': {
        e.preventDefault();
        setActiveIndex(0);
        selectProject(projects[0].id);
        const items = listRef.current?.querySelectorAll('[role="option"]');
        (items?.[0] as HTMLElement)?.focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        const lastIdx = projects.length - 1;
        setActiveIndex(lastIdx);
        selectProject(projects[lastIdx].id);
        const items = listRef.current?.querySelectorAll('[role="option"]');
        (items?.[lastIdx] as HTMLElement)?.focus();
        break;
      }
    }
  };

  // 현재 모든 프로젝트는 idle 상태 (팀/세션 기능 추가 시 동적으로 변경)
  const getStatus = (_projectId: string): ProjectStatus => 'idle';

  return (
    <aside
      className={`flex flex-col border-r border-border bg-sidebar transition-all duration-200 ${
        sidebarCollapsed ? 'w-[60px]' : 'w-[240px]'
      }`}
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        {!sidebarCollapsed && (
          <span className="text-sm font-semibold text-sidebar-foreground">
            Projects
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-secondary"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {sidebarCollapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {/* Project List */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Project list">
        {projects.length === 0 ? (
          !sidebarCollapsed && (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-text-muted">No projects yet</p>
            </div>
          )
        ) : (
          <ul
            ref={listRef}
            className="space-y-0.5"
            role="listbox"
            aria-label="프로젝트 선택"
            aria-activedescendant={
              activeIndex >= 0 && projects[activeIndex]
                ? `sidebar-project-${projects[activeIndex].id}`
                : undefined
            }
            onKeyDown={handleKeyDown}
          >
            {projects.map((project, index) => {
              const status = getStatus(project.id);
              const isSelected = project.id === selectedProjectId;
              const statusLabel = STATUS_LABELS[status];

              return (
                <li key={project.id} role="presentation">
                  <button
                    id={`sidebar-project-${project.id}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? 'bg-surface-3 font-medium'
                        : 'hover:bg-surface-2'
                    }`}
                    title={`${project.name} (${statusLabel})`}
                    onClick={() => {
                      selectProject(project.id);
                      setActiveIndex(index);
                    }}
                    onFocus={() => setActiveIndex(index)}
                    tabIndex={isSelected || (activeIndex === -1 && index === 0) ? 0 : -1}
                  >
                    {/* 색상 도트 + 상태 */}
                    <span className="relative inline-flex shrink-0">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: getProjectColor(project.colorIndex) }}
                        aria-hidden="true"
                      />
                      {/* 상태 인디케이터 도트 */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 inline-block h-1.5 w-1.5 rounded-full border border-sidebar ${
                          status === 'running'
                            ? 'bg-green-500'
                            : status === 'error'
                              ? 'bg-red-500'
                              : 'bg-zinc-500'
                        }`}
                        aria-label={statusLabel}
                      />
                    </span>
                    {!sidebarCollapsed && (
                      <span className="truncate">{project.name}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Account area (placeholder) */}
      <div className="border-t border-border p-3">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-surface-3" />
            <span className="text-xs text-text-secondary">Account</span>
          </div>
        )}
      </div>
    </aside>
  );
}
