import { useState, useCallback, useEffect, useMemo, memo } from "react";
import { Globe, Plus, ChevronDown, AlertCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../../../components/ui/popover";
import { cn } from "../../../lib/utils";
import { useSshStore } from "../stores/sshStore";
import { SshConnectionForm } from "./SshConnectionForm";
import type { SshConnection } from "../../../lib/tauri/commands";

interface SshQuickConnectProps {
  sessionName: string;
  projectId: string | null;
  disabled: boolean;
}

export const SshQuickConnect = memo(function SshQuickConnect({
  sessionName,
  projectId,
  disabled,
}: SshQuickConnectProps) {
  const connections = useSshStore((s) => s.connections);
  const activeConnectionId = useSshStore((s) => s.activeConnectionId);
  const fetchConnections = useSshStore((s) => s.fetchConnections);
  const storeError = useSshStore((s) => s.error);
  const connect = useSshStore((s) => s.connect);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const isActive = activeConnectionId !== null;

  // Fetch connections when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setConnectError(null);
      fetchConnections().catch(() => {});
    }
  }, [dropdownOpen, fetchConnections]);

  const handleConnect = useCallback(
    async (conn: SshConnection) => {
      setConnectError(null);
      try {
        await connect(conn.id, sessionName);
        setDropdownOpen(false);
      } catch (e) {
        setConnectError(String(e));
      }
    },
    [connect, sessionName],
  );

  // Sort: project connections first, then others
  const sorted = useMemo(
    () =>
      [...connections].sort((a, b) => {
        if (a.projectId === projectId && b.projectId !== projectId) return -1;
        if (a.projectId !== projectId && b.projectId === projectId) return 1;
        return 0;
      }),
    [connections, projectId],
  );

  const displayError = connectError || storeError;

  return (
    <>
      <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title="SSH Connect"
            className={cn(
              "h-[26px] px-1.5 text-xs gap-0.5",
              isActive
                ? "text-primary bg-primary/10 border border-primary/20"
                : "text-text-muted",
            )}
          >
            <Globe className="h-3 w-3" />
            SSH
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-xs font-medium text-text-secondary">
              SSH Connections
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px] text-text-muted"
              onClick={() => {
                setDropdownOpen(false);
                setFormOpen(true);
              }}
            >
              <Plus className="h-3 w-3 mr-0.5" />
              New
            </Button>
          </div>

          {/* Error display */}
          {displayError && (
            <div className="flex items-start gap-1.5 px-3 py-1.5 text-[10px] text-red-400 border-b border-white/[0.06]">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="break-words" title={displayError}>{displayError}</span>
            </div>
          )}

          {/* Connection list */}
          <div className="max-h-48 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-text-muted">
                No connections
              </div>
            ) : (
              sorted.map((conn) => (
                <button
                  key={conn.id}
                  disabled={conn.id === activeConnectionId}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                    conn.id === activeConnectionId
                      ? "opacity-60 cursor-default"
                      : "hover:bg-white/[0.08]",
                  )}
                  onClick={() => handleConnect(conn)}
                >
                  {/* Status dot */}
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      conn.id === activeConnectionId
                        ? "bg-success shadow-[0_0_4px_var(--color-success)]"
                        : "bg-white/20",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text truncate">
                      {conn.name}
                    </p>
                    <p className="text-[10px] text-text-muted truncate">
                      {conn.username}@{conn.host}
                      {conn.port !== 22 ? `:${conn.port}` : ""}
                    </p>
                  </div>
                  {conn.projectId === projectId && projectId && (
                    <span className="text-[9px] text-primary bg-primary/15 border border-primary/20 rounded px-1">
                      project
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* New connection form — unmount when closed to avoid idle hooks */}
      {formOpen && (
        <SshConnectionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          projectId={projectId}
        />
      )}
    </>
  );
});
