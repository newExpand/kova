import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { useSshStore } from "../stores/sshStore";
import type {
  SshConnection,
  CreateSshConnectionInput,
  UpdateSshConnectionInput,
} from "../../../lib/tauri/commands";

interface SshConnectionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editConnection?: SshConnection | null;
  projectId?: string | null;
}

export function SshConnectionForm({
  open: isOpen,
  onOpenChange,
  editConnection,
  projectId,
}: SshConnectionFormProps) {
  const createConnection = useSshStore((s) => s.createConnection);
  const updateConnection = useSshStore((s) => s.updateConnection);

  const [name, setName] = useState(editConnection?.name ?? "");
  const [host, setHost] = useState(editConnection?.host ?? "");
  const [port, setPort] = useState(String(editConnection?.port ?? 22));
  const [username, setUsername] = useState(editConnection?.username ?? "");
  const [authType, setAuthType] = useState<"key" | "agent">(
    (editConnection?.authType as "key" | "agent") ?? "key",
  );
  const [keyPath, setKeyPath] = useState(editConnection?.keyPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!editConnection;

  // Re-initialize form when dialog opens or editConnection changes
  useEffect(() => {
    if (isOpen) {
      setName(editConnection?.name ?? "");
      setHost(editConnection?.host ?? "");
      setPort(String(editConnection?.port ?? 22));
      setUsername(editConnection?.username ?? "");
      setAuthType(editConnection?.authType ?? "key");
      setKeyPath(editConnection?.keyPath ?? "");
      setError(null);
    }
  }, [isOpen, editConnection]);

  const resetForm = useCallback(() => {
    setName(editConnection?.name ?? "");
    setHost(editConnection?.host ?? "");
    setPort(String(editConnection?.port ?? 22));
    setUsername(editConnection?.username ?? "");
    setAuthType((editConnection?.authType as "key" | "agent") ?? "key");
    setKeyPath(editConnection?.keyPath ?? "");
    setError(null);
  }, [editConnection]);

  const handleBrowseKey = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: "~/.ssh",
        title: "Select SSH Key",
      });
      if (selected) {
        setKeyPath(selected);
      }
    } catch (e) {
      setError(`Failed to open file dialog: ${String(e)}`);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      if (isEdit && editConnection) {
        const input: UpdateSshConnectionInput = {
          name: name !== editConnection.name ? name : undefined,
          host: host !== editConnection.host ? host : undefined,
          port:
            Number(port) !== editConnection.port ? Number(port) : undefined,
          username:
            username !== editConnection.username ? username : undefined,
          authType:
            authType !== editConnection.authType ? authType : undefined,
          keyPath:
            keyPath !== (editConnection.keyPath ?? "")
              ? keyPath || null
              : undefined,
        };
        await updateConnection(editConnection.id, input);
      } else {
        const input: CreateSshConnectionInput = {
          name,
          host,
          port: Number(port),
          username,
          authType,
          keyPath: authType === "key" ? keyPath : undefined,
          projectId: projectId ?? undefined,
        };
        await createConnection(input);
      }
      onOpenChange(false);
      resetForm();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [
    isEdit,
    editConnection,
    name,
    host,
    port,
    username,
    authType,
    keyPath,
    projectId,
    createConnection,
    updateConnection,
    onOpenChange,
    resetForm,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit SSH Connection" : "New SSH Connection"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the SSH connection settings."
              : "Add a new SSH connection profile."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ssh-name">Name</Label>
            <Input
              id="ssh-name"
              placeholder="My Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[1fr_80px] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-host">Host</Label>
              <Input
                id="ssh-host"
                placeholder="192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-port">Port</Label>
              <Input
                id="ssh-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ssh-username">Username</Label>
            <Input
              id="ssh-username"
              placeholder="root"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Auth Type</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="authType"
                  value="key"
                  checked={authType === "key"}
                  onChange={() => setAuthType("key")}
                  className="accent-primary"
                />
                SSH Key
              </label>
              <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="authType"
                  value="agent"
                  checked={authType === "agent"}
                  onChange={() => setAuthType("agent")}
                  className="accent-primary"
                />
                SSH Agent
              </label>
            </div>
          </div>

          {authType === "key" && (
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-keypath">Key Path</Label>
              <div className="flex gap-2">
                <Input
                  id="ssh-keypath"
                  placeholder="~/.ssh/id_rsa"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-9"
                  onClick={handleBrowseKey}
                >
                  Browse
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
