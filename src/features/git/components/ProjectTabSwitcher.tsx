import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { TerminalSquare, GitBranch, FileText } from "lucide-react";

interface ProjectTabSwitcherProps {
  projectId: string;
}

const TABS = [
  { key: "terminal", label: "Terminal", icon: TerminalSquare },
  { key: "git", label: "Git Graph", icon: GitBranch },
  { key: "files", label: "Files", icon: FileText },
] as const;

export function ProjectTabSwitcher({ projectId }: ProjectTabSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab = location.pathname.includes("/git")
    ? "git"
    : location.pathname.includes("/files")
      ? "files"
      : "terminal";

  return (
    <div className="relative flex h-6 items-center select-none rounded-lg border border-white/[0.10] bg-white/[0.03] p-0.5">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() =>
              navigate(`/projects/${projectId}/${tab.key}`)
            }
            className={`relative z-10 flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors ${
              isActive ? "text-text" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="tab-pill"
                className="absolute inset-0 rounded-md bg-white/[0.12]"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <Icon className="relative z-10 h-3 w-3" />
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
