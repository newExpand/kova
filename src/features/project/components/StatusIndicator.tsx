import { Circle, PlayCircle, AlertCircle } from 'lucide-react';
import type { ProjectStatus } from '../types';
import { STATUS_COLORS, STATUS_LABELS } from '../types';

interface StatusIndicatorProps {
  status: ProjectStatus;
  className?: string;
}

const ICON_MAP = {
  idle: Circle,
  running: PlayCircle,
  error: AlertCircle,
} as const;

/**
 * 프로젝트 상태 인디케이터
 *
 * 아이콘 + 텍스트 + 색상으로 상태 표시
 */
export function StatusIndicator({ status, className = '' }: StatusIndicatorProps) {
  const Icon = ICON_MAP[status];
  const colorClass = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];

  return (
    <div
      className={`flex items-center gap-1.5 text-sm ${colorClass} ${className}`}
      role="status"
      aria-label={`상태: ${label}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
