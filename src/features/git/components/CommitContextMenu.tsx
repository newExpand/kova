import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { GitBranchPlus, GitBranch, Trash2 } from "lucide-react";
import type { GitCommit } from "../../../lib/tauri/commands";
import { useGitStore } from "../stores/gitStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";

interface CommitContextMenuProps {
  commit: GitCommit;
  projectId: string;
  projectPath: string;
  onCreateBranch: (commit: GitCommit) => void;
  children: (props: {
    onContextMenu: (e: React.MouseEvent) => void;
    onRefContextMenu: (e: React.MouseEvent, refName: string) => void;
  }) => React.ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function CommitContextMenu({
  commit,
  projectId,
  projectPath,
  onCreateBranch,
  children,
}: CommitContextMenuProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [targetRef, setTargetRef] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDirtySwitch, setConfirmDirtySwitch] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const refreshStatus = useGitStore((s) => s.refreshStatus);

  const headBranchName = commit.refs.find((r) => r.refType === "head")?.name;

  const openMenu = useCallback(
    (e: React.MouseEvent, refName: string | null) => {
      e.preventDefault();
      const MENU_W = 220;
      const MENU_H = 160;
      const x = Math.min(e.clientX, window.innerWidth - MENU_W);
      const y = Math.min(e.clientY, window.innerHeight - MENU_H);
      setMenuPos({ x: Math.max(0, x), y: Math.max(0, y) });
      setTargetRef(refName);
    },
    [],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => openMenu(e, null),
    [openMenu],
  );

  const handleRefContextMenu = useCallback(
    (e: React.MouseEvent, refName: string) => {
      e.stopPropagation();
      openMenu(e, refName);
    },
    [openMenu],
  );

  const closeMenu = useCallback(() => {
    setMenuPos(null);
    setTargetRef(null);
  }, []);

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

  const handleCreateBranch = useCallback(() => {
    closeMenu();
    onCreateBranch(commit);
  }, [closeMenu, onCreateBranch, commit]);

  const handleSwitch = useCallback(
    async (branchName: string) => {
      closeMenu();
      try {
        const status = await refreshStatus(projectPath);
        if (status && status.isDirty) {
          setConfirmDirtySwitch(branchName);
          return;
        }
        // status null means check failed — proceed anyway, git will guard
        await switchBranch(projectPath, branchName, projectId);
      } catch (e) {
        setSwitchError(`Failed to switch to ${branchName}: ${String(e)}`);
      }
    },
    [closeMenu, projectPath, projectId, switchBranch, refreshStatus],
  );

  const handleConfirmDirtySwitch = useCallback(async () => {
    if (!confirmDirtySwitch) return;
    const branchName = confirmDirtySwitch;
    setConfirmDirtySwitch(null);
    try {
      await switchBranch(projectPath, branchName, projectId);
    } catch (e) {
      setSwitchError(`Failed to switch to ${branchName}: ${String(e)}`);
    }
  }, [confirmDirtySwitch, switchBranch, projectPath, projectId]);

  const handleDelete = useCallback(
    (branchName: string) => {
      closeMenu();
      setDeleteError(null);
      setConfirmDelete(branchName);
    },
    [closeMenu],
  );

  const handleConfirmDelete = useCallback(
    async (force: boolean) => {
      if (!confirmDelete) return;
      try {
        await deleteBranch(projectPath, confirmDelete, force, projectId);
        setConfirmDelete(null);
        setDeleteError(null);
      } catch (e) {
        // Any safe-delete (-d) failure: offer force-delete option
        // Force-delete (-D) failure: show error, keep dialog open
        setDeleteError(String(e));
      }
    },
    [confirmDelete, deleteBranch, projectPath, projectId],
  );

  return (
    <>
      {children({ onContextMenu: handleContextMenu, onRefContextMenu: handleRefContextMenu })}

      {/* Context menu — portal to body */}
      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] rounded-lg border border-white/[0.1] glass-elevated py-1 shadow-xl"
            style={{ left: menuPos.x, top: menuPos.y }}
          >
            <MenuItem
              icon={<GitBranchPlus className="h-3.5 w-3.5" />}
              label="Create Branch Here"
              onClick={handleCreateBranch}
            />

            {targetRef && targetRef !== headBranchName && (
              <>
                <div className="my-1 border-t border-white/[0.06]" />
                <MenuItem
                  icon={<GitBranch className="h-3.5 w-3.5" />}
                  label={`Switch to ${targetRef}`}
                  onClick={() => handleSwitch(targetRef)}
                />
              </>
            )}

            {targetRef &&
              targetRef !== headBranchName &&
              targetRef !== "main" &&
              targetRef !== "master" && (
                <>
                  <div className="my-1 border-t border-white/[0.06]" />
                  <MenuItem
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    label={`Delete ${targetRef}`}
                    onClick={() => handleDelete(targetRef)}
                    danger
                  />
                </>
              )}
          </div>,
          document.body,
        )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Branch</DialogTitle>
            <DialogDescription>
              Delete branch{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {confirmDelete}
              </code>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmDelete(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            {deleteError ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleConfirmDelete(true)}
              >
                Force Delete
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleConfirmDelete(false)}
              >
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dirty switch confirmation dialog */}
      <Dialog
        open={confirmDirtySwitch !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDirtySwitch(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Uncommitted Changes</DialogTitle>
            <DialogDescription>
              You have uncommitted changes. Switching to{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {confirmDirtySwitch}
              </code>{" "}
              may fail if changes conflict with the target branch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDirtySwitch(null)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmDirtySwitch}>
              Switch Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Switch error dialog */}
      <Dialog
        open={switchError !== null}
        onOpenChange={(open) => {
          if (!open) setSwitchError(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch Failed</DialogTitle>
            <DialogDescription>
              {switchError}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" onClick={() => setSwitchError(null)}>
              OK
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
      <span className="truncate">{label}</span>
    </button>
  );
}
