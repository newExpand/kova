import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { useFileStore } from "../stores/fileStore";
import type { FileEntry } from "../../../lib/tauri/commands";

interface FileTreeContextMenuProps {
  entry: FileEntry;
  projectPath: string;
  children: (props: {
    onContextMenu: (e: React.MouseEvent) => void;
  }) => React.ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function FileTreeContextMenu({
  entry,
  projectPath,
  children,
}: FileTreeContextMenuProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startInlineCreate = useFileStore((s) => s.startInlineCreate);
  const deleteEntry = useFileStore((s) => s.deleteEntry);
  const renameEntry = useFileStore((s) => s.renameEntry);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenuPos(null), []);

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!menuPos || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let { x, y } = menuPos;
    if (rect.right > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (rect.bottom > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menuPos.x || y !== menuPos.y) {
      setMenuPos({ x, y });
    }
  }, [menuPos]);

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

  // Auto-focus rename input
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select name without extension
      const dotIdx = renameValue.lastIndexOf(".");
      if (dotIdx > 0) {
        renameInputRef.current.setSelectionRange(0, dotIdx);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [isRenaming, renameValue]);

  const handleNew = useCallback(
    (isDir: boolean) => {
      closeMenu();
      const dir = entry.isDir ? entry.path : getParentDir(entry.path);
      startInlineCreate(projectPath, dir, isDir);
    },
    [closeMenu, entry, projectPath, startInlineCreate],
  );

  const handleRenameStart = useCallback(() => {
    closeMenu();
    setRenameValue(entry.name);
    setIsRenaming(true);
  }, [closeMenu, entry.name]);

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === entry.name || !isValidFileName(trimmed)) {
      setIsRenaming(false);
      return;
    }
    setRenameError(null);
    const err = await renameEntry(projectPath, entry.path, trimmed);
    if (err) {
      setRenameError(err);
    } else {
      setIsRenaming(false);
    }
  }, [renameValue, entry.name, entry.path, projectPath, renameEntry]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameConfirm();
      } else if (e.key === "Escape") {
        setIsRenaming(false);
      }
    },
    [handleRenameConfirm],
  );

  const handleDelete = useCallback(async () => {
    setDeleteError(null);
    const err = await deleteEntry(projectPath, entry.path);
    if (err) {
      setDeleteError(err);
    } else {
      setConfirmDelete(false);
    }
  }, [projectPath, entry.path, deleteEntry]);

  return (
    <>
      {children({ onContextMenu: handleContextMenu })}

      {/* Context menu — portal to body to escape overflow containers */}
      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[160px] rounded-lg border border-white/[0.1] glass-elevated py-1 shadow-xl"
            style={{ left: menuPos.x, top: menuPos.y }}
          >
            {entry.isDir && (
              <>
                <MenuItem
                  icon={<FilePlus className="h-3.5 w-3.5" />}
                  label="New File"
                  onClick={() => handleNew(false)}
                />
                <MenuItem
                  icon={<FolderPlus className="h-3.5 w-3.5" />}
                  label="New Folder"
                  onClick={() => handleNew(true)}
                />
                <div className="my-1 border-t border-white/[0.06]" />
              </>
            )}
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Rename"
              onClick={handleRenameStart}
            />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              onClick={() => {
                closeMenu();
                setConfirmDelete(true);
              }}
              danger
            />
          </div>,
          document.body,
        )}

      {/* Rename inline dialog */}
      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>
              Enter a new name for{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {entry.name}
              </code>
            </DialogDescription>
          </DialogHeader>
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => { setRenameValue(e.target.value); setRenameError(null); }}
            onKeyDown={handleRenameKeyDown}
            className="w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
          {renameError && (
            <p className="text-xs text-danger">{renameError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setIsRenaming(false); setRenameError(null); }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleRenameConfirm}
              disabled={!renameValue.trim() || renameValue.trim() === entry.name || !isValidFileName(renameValue.trim())}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {entry.isDir ? "Folder" : "File"}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <code className="rounded bg-white/[0.06] px-1 text-xs">
                {entry.name}
              </code>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-xs text-danger">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Helpers ──

function getParentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function isValidFileName(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\0")) return false;
  if (name === "." || name === "..") return false;
  return true;
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
