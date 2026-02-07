/**
 * 프로젝트 상태
 */
export type ProjectStatus = 'idle' | 'running' | 'error';

/**
 * 프로젝트 정보
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  colorIndex: number;
  accountId: string | null;
  defaultPrompt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  pathExists: boolean;
}

/**
 * 프로젝트 생성 입력
 */
export interface CreateProjectInput {
  name: string;
  path: string;
}

/**
 * 프로젝트 수정 입력 (Story 1.4)
 */
export interface UpdateProjectInput {
  name?: string;
  path?: string;
  accountId?: string | null;
  defaultPrompt?: string | null;
}

/**
 * 8-색상 팔레트 (Sky, Violet, Emerald, Amber, Rose, Cyan, Orange, Lime)
 */
export const COLOR_PALETTE = [
  '#38BDF8', // Sky
  '#8B5CF6', // Violet
  '#34D399', // Emerald
  '#FBBF24', // Amber
  '#FB7185', // Rose
  '#22D3EE', // Cyan
  '#FB923C', // Orange
  '#A3E635', // Lime
] as const;

/**
 * 색상 인덱스로부터 색상 값 가져오기
 */
export function getProjectColor(colorIndex: number): string {
  return COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
}

/**
 * 상태별 아이콘 매핑
 */
export const STATUS_ICONS: Record<ProjectStatus, string> = {
  idle: 'circle',
  running: 'play-circle',
  error: 'alert-circle',
};

/**
 * 상태별 색상 매핑 (Tailwind 클래스)
 */
export const STATUS_COLORS: Record<ProjectStatus, string> = {
  idle: 'text-muted-foreground',
  running: 'text-green-500',
  error: 'text-red-500',
};

/**
 * 상태별 레이블
 */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  idle: '대기 중',
  running: '실행 중',
  error: '오류',
};
