import { useState, useCallback } from "react";
import { Plus, Globe } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { useSshConnections } from "../hooks/useSshConnections";
import { useSshStore } from "../stores/sshStore";
import { SshConnectionCard } from "./SshConnectionCard";
import { SshConnectionForm } from "./SshConnectionForm";
import type { SshConnection, SshTestResult } from "../../../lib/tauri/commands";

export default function SshConnectionList() {
  const { connections, isLoading, error } = useSshConnections();
  const deleteConnection = useSshStore((s) => s.deleteConnection);
  const testConnection = useSshStore((s) => s.testConnection);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SshConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SshConnection | null>(null);

  const handleEdit = useCallback((conn: SshConnection) => {
    setEditTarget(conn);
    setFormOpen(true);
  }, []);

  const handleDeleteRequest = useCallback((id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (conn) setDeleteTarget(conn);
  }, [connections]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteConnection(deleteTarget.id);
    } catch (e) {
      console.error("Delete connection failed:", e);
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteConnection]);

  const handleTest = useCallback(
    async (id: string): Promise<SshTestResult> => {
      try {
        return await testConnection(id);
      } catch {
        return { success: false, message: "Test failed" };
      }
    },
    [testConnection],
  );

  const handleFormClose = useCallback((open: boolean) => {
    setFormOpen(open);
    if (!open) setEditTarget(null);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text">SSH Connections</h2>
          <span className="text-xs text-text-muted">
            ({connections.length})
          </span>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setEditTarget(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && connections.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">
            Loading...
          </p>
        )}

        {!isLoading && connections.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Globe className="h-8 w-8 text-text-muted" />
            <p className="text-sm text-text-muted">
              No SSH connections configured
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFormOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Connection
            </Button>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 mb-2">{error}</p>
        )}

        <div className="grid gap-2">
          {connections.map((conn) => (
            <SshConnectionCard
              key={conn.id}
              connection={conn}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onTest={handleTest}
            />
          ))}
        </div>
      </div>

      {/* Form dialog */}
      <SshConnectionForm
        open={formOpen}
        onOpenChange={handleFormClose}
        editConnection={editTarget}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete SSH Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
