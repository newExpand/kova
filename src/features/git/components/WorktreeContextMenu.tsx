import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Terminal, GitBranchPlus, GitMerge, Trash2 } from "lucide-react";
import type { GitWorktree } from "../../../lib/tauri/commands";
import {
  selectTmuxWindow,
  pushGitBranch,
  removeAgentWorktree,
} from "../../../lib/tauri/commands";
import { useNavigate } from "react-router-dom";
import { useMergeStore } from "../stores/mergeStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";

interface WorktreeContextMenuProps {
  worktree: GitWorktree;
  projectId: string;
  projectPath: string;
  sessionName: string | null;
  onDeleted?: (worktreePath: string) => void;
  children: (props: {
    onContextMenu: (e: React.MouseEvent) => void;
  }) => React.ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function WorktreeContextMenu({
  worktree,
  projectId,
  projectPath,
  sessionName,
  onDeleted,
  children,
}: WorktreeContextMenuProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const isClaudeWorktree = worktree.path.includes(".claude/worktrees/");
  const taskName = isClaudeWorktree
    ? worktree.path.split(".claude/worktrees/").pop()?.replace(/\/$/, "") ?? null
    : null;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (worktree.isMain && !isClaudeWorktree) {
        return;
      }
      e.preventDefault();
      setMenuPos({ x: e.clientX, y: e.clientY });
    },
    [worktree.isMain, isClaudeWorktree],
  );

  const closeMenu = useCallback(() => setMenuPos(null), []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!menuPos) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuPos, closeMenu]);

  const handleOpenTerminal = useCallback(() => {
    closeMenu();
    navigate(`/projects/${projectId}/terminal`);
    if (sessionName && taskName) {
      selectTmuxWindow(sessionName, taskName).catch((e) => {
        console.warn(`Failed to select tmux window '${taskName}':`, e);
      });
    }
  }, [closeMenu, navigate, projectId, sessionName, taskName]);

  const handlePushBranch = useCallback(async () => {
    closeMenu();
    if (!worktree.branch) return;
    try {
      await pushGitBranch(projectPath, worktree.branch);
    } catch (e) {
      console.error(`Push branch '${worktree.branch}' failed:`, e);
    }
  }, [closeMenu, projectPath, worktree.branch]);

  const handleMergeToMain = useCallback(() => {
    closeMenu();
    if (!worktree.branch) return;
    useMergeStore.getState().requestMerge({
      repoPath: projectPath,
      worktreePath: worktree.path,
      branchName: worktree.branch,
      agent: sessionName && taskName ? { sessionName, taskName } : null,
    });
  }, [closeMenu, projectPath, worktree.path, worktree.branch, sessionName, taskName]);

  const handleDeleteWorktree = useCallback(async () => {
    setConfirmDelete(false);
    try {
      const result = await removeAgentWorktree(
        projectPath,
        worktree.path,
        sessionName,
        worktree.branch,
        false,
      );
      if (worktree.branch && !result.branchDeleted) {
        console.warn(`Worktree removed but branch '${worktree.branch}' was not deleted`);
      }
      onDeleted?.(worktree.path);
    } catch (e) {
      console.error("Delete worktree failed:", e);
    }
  }, [projectPath, worktree.path, worktree.branch, sessionName, onDeleted]);

  return (
    <>
      {children({ onContextMenu: handleContextMenu })}

      {/* Context menu — portal to body to escape overflow containers */}
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] rounded-lg border border-white/[0.1] glass-elevated py-1 shadow-xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {isClaudeWorktree && (
            <MenuItem
              icon={<Terminal className="h-3.5 w-3.5" />}
              label="Open Terminal"
              onClick={handleOpenTerminal}
            />
          )}
          {worktree.branch && (
            <MenuItem
              icon={<GitBranchPlus className="h-3.5 w-3.5" />}
              label="Push Branch"
              onClick={handlePushBranch}
            />
          )}
          {worktree.branch && !worktree.isMain && (
            <MenuItem
              icon={<GitMerge className="h-3.5 w-3.5" />}
              label="Merge to Main"
              onClick={handleMergeToMain}
            />
          )}
          {!worktree.isMain && (
            <>
              <div className="my-1 border-t border-white/[0.06]" />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Delete Worktree"
                onClick={() => {
                  closeMenu();
                  setConfirmDelete(true);
                }}
                danger
              />
            </>
          )}
        </div>,
        document.body,
      )}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Worktree</DialogTitle>
            <DialogDescription>
              This will remove the worktree at{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {taskName ?? worktree.path}
              </code>{" "}
              and delete the branch{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {worktree.branch ?? "unknown"}
              </code>
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteWorktree}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-text-secondary hover:bg-white/[0.06] hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
