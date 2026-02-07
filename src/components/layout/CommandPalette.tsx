import * as React from "react";
import {
  LayoutDashboard,
  FolderPlus,
  Settings,
  Search,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** 프로젝트 색상 팔레트 (8색) */
const PROJECT_COLORS = [
  "#38BDF8", // Sky
  "#8B5CF6", // Violet
  "#34D399", // Emerald
  "#FBBF24", // Amber
  "#FB7185", // Rose
  "#22D3EE", // Cyan
  "#FB923C", // Orange
  "#A3E635", // Lime
] as const;

/** 팀 상태에 따른 배지 스타일 */
const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  idle: {
    label: "대기",
    className: "bg-zinc-500/20 text-zinc-400",
  },
  running: {
    label: "실행 중",
    className: "bg-emerald-500/20 text-emerald-400",
  },
  error: {
    label: "오류",
    className: "bg-rose-500/20 text-rose-400",
  },
};

interface ProjectItem {
  id: string;
  name: string;
  colorIndex: number;
  status: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects?: ProjectItem[];
  onSelectProject?: (id: string) => void;
  onAction?: (action: string) => void;
}

function ProjectColorDot({ colorIndex }: { colorIndex: number }) {
  const color = PROJECT_COLORS[colorIndex % PROJECT_COLORS.length];
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.idle;
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        style.className,
      )}
      aria-label={`상태: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

/**
 * 스크린 리더 / 키보드 사용자를 위한 스킵 링크 (WCAG 2.4.1)
 * 포커스 시에만 화면에 표시됨
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:top-3 focus:left-3 focus:z-[100]",
        "focus:rounded-md focus:bg-primary focus:px-4 focus:py-2",
        "focus:text-sm focus:font-medium focus:text-primary-foreground",
        "focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      )}
    >
      메인 콘텐츠로 건너뛰기
    </a>
  );
}

/**
 * 대시보드 카드의 접근성 속성을 반환하는 헬퍼
 * ProjectCard (Agent A 코드)에서 사용됨
 */
export function getCardA11yProps(projectName: string, status: string) {
  return {
    tabIndex: 0,
    role: "article" as const,
    "aria-label": `${projectName} - ${status}`,
  };
}

export function CommandPalette({
  open,
  onOpenChange,
  projects = [],
  onSelectProject,
  onAction,
}: CommandPaletteProps) {
  const handleSelect = React.useCallback(
    (action: string) => {
      onOpenChange(false);
      onAction?.(action);
    },
    [onOpenChange, onAction],
  );

  const handleProjectSelect = React.useCallback(
    (projectId: string) => {
      onOpenChange(false);
      onSelectProject?.(projectId);
    },
    [onOpenChange, onSelectProject],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="커맨드 팔레트"
      description="명령어를 검색하여 빠르게 실행하세요"
      showCloseButton={false}
      className="sm:max-w-[640px]"
    >
      <CommandInput placeholder="명령어 검색..." />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-1 py-4">
            <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">결과가 없습니다</p>
          </div>
        </CommandEmpty>

        {projects.length > 0 && (
          <>
            <CommandGroup heading="프로젝트">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project-${project.name}`}
                  onSelect={() => handleProjectSelect(project.id)}
                >
                  <ProjectColorDot colorIndex={project.colorIndex} />
                  <span className="truncate">{project.name}</span>
                  <StatusBadge status={project.status} />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="액션">
          <CommandItem
            value="새 프로젝트 등록"
            onSelect={() => handleSelect("new-project")}
          >
            <FolderPlus className="text-muted-foreground" />
            <span>프로젝트 등록</span>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="대시보드로 이동"
            onSelect={() => handleSelect("navigate-dashboard")}
          >
            <LayoutDashboard className="text-muted-foreground" />
            <span>대시보드로 이동</span>
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="설정">
          <CommandItem
            value="설정 열기"
            onSelect={() => handleSelect("open-settings")}
          >
            <Settings className="text-muted-foreground" />
            <span>설정 열기</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
