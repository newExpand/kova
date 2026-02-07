import type { ReactNode } from 'react';

interface ProjectGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * 반응형 프로젝트 그리드
 *
 * CSS Grid: repeat(auto-fill, minmax(300px, 1fr)), gap 16px
 */
export function ProjectGrid({ children, className = '' }: ProjectGridProps) {
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 ${className}`}
      role="grid"
      aria-label="프로젝트 목록"
    >
      {children}
    </div>
  );
}
