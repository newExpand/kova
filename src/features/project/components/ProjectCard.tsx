import { StatusIndicator } from './StatusIndicator';
import type { Project, ProjectStatus } from '../types';
import { getProjectColor, STATUS_LABELS } from '../types';

interface ProjectCardProps {
  project: Project;
  status?: ProjectStatus;
  onClick?: () => void;
  onDelete?: () => void;
}

/**
 * 프로젝트 카드 컴포넌트
 *
 * - 왼쪽 4px 색상 바
 * - 프로젝트 이름 (H2, 16px Medium)
 * - 경로 (Mono 13px, truncated)
 * - 상태 인디케이터
 * - Hover: Surface 3 bg, scale(1.01) + shadow (100ms)
 * - 키보드 접근성: tabIndex, Enter/Space로 클릭
 */
export function ProjectCard({ project, status = 'idle', onClick, onDelete }: ProjectCardProps) {
  const accentColor = getProjectColor(project.colorIndex);
  const statusLabel = STATUS_LABELS[status];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete?.();
    }
  };

  return (
    <article
      className="relative flex h-32 cursor-pointer overflow-hidden rounded-lg bg-surface-2 transition-all duration-100 hover:scale-[1.01] hover:bg-surface-3 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="article"
      aria-label={`${project.name} - ${statusLabel}`}
    >
      {/* 왼쪽 색상 바 */}
      <div
        className="w-1 flex-shrink-0"
        style={{ backgroundColor: accentColor }}
        aria-hidden="true"
      />

      {/* 카드 내용 */}
      <div className="flex flex-1 flex-col justify-between p-4">
        {/* 상단: 프로젝트 정보 */}
        <div className="space-y-2">
          <h2 className="text-base font-medium text-foreground">{project.name}</h2>
          <p
            className="truncate font-mono text-[13px] text-muted-foreground"
            title={project.path}
          >
            {project.path}
          </p>
        </div>

        {/* 하단: 상태 인디케이터 */}
        <StatusIndicator status={status} />
      </div>
    </article>
  );
}
