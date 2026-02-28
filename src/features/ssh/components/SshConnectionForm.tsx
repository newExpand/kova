import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, FolderOpen, Search, Wifi } from "lucide-react";
import { testSshConnectionParams, detectRemoteGitPaths } from "../../../lib/tauri/commands";
import type { SshTestResult } from "../../../lib/tauri/commands";
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
import { cn } from "../../../lib/utils";
import { useSshStore } from "../stores/sshStore";
import type {
  SshConnection,
  CreateSshConnectionInput,
  UpdateSshConnectionInput,
} from "../../../lib/tauri/commands";

const AUTH_OPTIONS = [
  { value: "key" as const, label: "SSH Key" },
  { value: "agent" as const, label: "SSH Agent" },
];

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
    editConnection?.authType ?? "key",
  );
  const [keyPath, setKeyPath] = useState(editConnection?.keyPath ?? "");
  const [remoteProjectPath, setRemoteProjectPath] = useState(
    editConnection?.remoteProjectPath ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SshTestResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectedPaths, setDetectedPaths] = useState<string[] | null>(null);
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
      setRemoteProjectPath(editConnection?.remoteProjectPath ?? "");
      setError(null);
      setTestResult(null);
      setDetectedPaths(null);
    }
  }, [isOpen, editConnection]);

  const handleTest = useCallback(async () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const result = await testSshConnectionParams(
        host,
        Number(port),
        username,
        authType,
        authType === "key" ? keyPath || undefined : undefined,
      );
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  }, [host, port, username, authType, keyPath]);

  const handleDetect = useCallback(async () => {
    setError(null);
    setDetectedPaths(null);
    setDetecting(true);
    try {
      const paths = await detectRemoteGitPaths(
        host,
        Number(port),
        username,
        authType,
        authType === "key" ? keyPath || undefined : undefined,
      );
      if (paths.length === 0) {
        setDetectedPaths([]);
      } else if (paths.length === 1 && paths[0]) {
        setRemoteProjectPath(paths[0]);
        setDetectedPaths(null);
      } else {
        setDetectedPaths(paths);
      }
    } catch (e) {
      setError(`Detect failed: ${String(e)}`);
    } finally {
      setDetecting(false);
    }
  }, [host, port, username, authType, keyPath]);

  const canTest = host.trim() !== "" && username.trim() !== "";

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
          remoteProjectPath:
            remoteProjectPath !== (editConnection.remoteProjectPath ?? "")
              ? remoteProjectPath || null
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
          remoteProjectPath: remoteProjectPath || undefined,
        };
        await createConnection(input);
      }
      onOpenChange(false);
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
    remoteProjectPath,
    projectId,
    createConnection,
    updateConnection,
    onOpenChange,
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

          {/* Segmented Control for Auth Type */}
          <div className="grid gap-1.5">
            <Label>Auth Type</Label>
            <div
              role="group"
              aria-label="Authentication type"
              className="flex rounded-lg border border-white/[0.08] bg-black/20 p-0.5"
            >
              {AUTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={authType === opt.value}
                  onClick={() => setAuthType(opt.value)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150",
                    authType === opt.value
                      ? "bg-white/[0.10] text-text shadow-sm"
                      : "text-text-muted hover:text-text-secondary",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {authType === "key" && (
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-keypath">Key Path</Label>
              <div className="relative">
                <Input
                  id="ssh-keypath"
                  placeholder="~/.ssh/id_rsa"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={handleBrowseKey}
                  title="Browse for SSH key"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="ssh-remote-path">Remote Project Path</Label>
            <div className="relative">
              <Input
                id="ssh-remote-path"
                placeholder="/home/user/project"
                value={remoteProjectPath}
                onChange={(e) => {
                  setRemoteProjectPath(e.target.value);
                  setDetectedPaths(null);
                }}
                className="pr-9"
              />
              <button
                type="button"
                onClick={handleDetect}
                disabled={!canTest || detecting}
                title="Detect git repositories on remote server"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
              >
                <Search className={`h-4 w-4 ${detecting ? "animate-pulse" : ""}`} />
              </button>
            </div>
            {detectedPaths !== null && detectedPaths.length === 0 && (
              <p className="text-[10px] text-text-muted">
                No git repositories found in home directory
              </p>
            )}
            {detectedPaths !== null && detectedPaths.length > 1 && (
              <div className="flex flex-col gap-0.5">
                {detectedPaths.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setRemoteProjectPath(p);
                      setDetectedPaths(null);
                    }}
                    className="text-left text-[11px] text-text-muted hover:text-text hover:bg-white/[0.06] rounded px-1.5 py-0.5 transition-colors truncate"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            {!detectedPaths && (
              <p className="text-[10px] text-text-muted">
                Absolute path to a git repository on the remote server (enables Git Graph)
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs",
                testResult.success ? "text-success" : "text-red-400",
              )}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              <p>{testResult.message}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="mr-auto gap-1"
            disabled={!canTest || testing || saving}
            onClick={handleTest}
          >
            <Wifi className="h-3.5 w-3.5" />
            {testing ? "Testing..." : "Test"}
          </Button>
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
