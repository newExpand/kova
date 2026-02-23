import { useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { useGitStore } from "../stores/gitStore";

export interface CommitTarget {
  hash: string;
  shortHash: string;
  message: string;
}

interface CreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commit: CommitTarget;
  projectId: string;
  projectPath: string;
}

const BRANCH_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;
const MAX_BRANCH_NAME_LENGTH = 100;

export function CreateBranchDialog({
  open,
  onOpenChange,
  commit,
  projectId,
  projectPath,
}: CreateBranchDialogProps) {
  const [branchName, setBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createBranch = useGitStore((s) => s.createBranch);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setBranchName("");
      setError(null);
    }
  }, [open]);

  const isValid =
    branchName.length > 0 &&
    branchName.length <= MAX_BRANCH_NAME_LENGTH &&
    BRANCH_NAME_REGEX.test(branchName) &&
    !branchName.endsWith(".lock") &&
    !branchName.includes("..");

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;

    setIsLoading(true);
    setError(null);

    try {
      await createBranch(projectPath, branchName, commit.hash, projectId);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [isValid, createBranch, projectPath, branchName, commit.hash, projectId, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && isValid && !isLoading) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [isValid, isLoading, handleSubmit],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Branch</DialogTitle>
          <DialogDescription>
            Create a new branch at commit{" "}
            <code className="rounded bg-white/[0.06] px-1 text-xs">
              {commit.shortHash}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Commit context */}
          <p className="truncate text-xs text-text-muted">{commit.message}</p>

          <div>
            <label
              htmlFor="branch-name"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              Branch name
            </label>
            <input
              id="branch-name"
              type="text"
              autoFocus
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="feature/my-branch"
              maxLength={MAX_BRANCH_NAME_LENGTH}
              className="w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {branchName.length > 0 && !isValid && (
              <p className="mt-1 text-xs text-danger">
                Letters, numbers, hyphens, dots, underscores, slashes only
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!isValid || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Creating...
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
