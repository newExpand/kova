import { useState, useCallback, useEffect, useRef } from "react";
import { Globe, Plus, ChevronDown } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useSshStore } from "../stores/sshStore";
import { SshConnectionForm } from "./SshConnectionForm";
import type { SshConnection } from "../../../lib/tauri/commands";

interface SshQuickConnectProps {
  sessionName: string;
  projectId: string | null;
  disabled: boolean;
}

export function SshQuickConnect({
  sessionName,
  projectId,
  disabled,
}: SshQuickConnectProps) {
  const connections = useSshStore((s) => s.connections);
  const fetchConnections = useSshStore((s) => s.fetchConnections);
  const storeError = useSshStore((s) => s.error);
  const connect = useSshStore((s) => s.connect);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch connections when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setConnectError(null);
      fetchConnections();
    }
  }, [dropdownOpen, fetchConnections]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

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
  const sorted = [...connections].sort((a, b) => {
    if (a.projectId === projectId && b.projectId !== projectId) return -1;
    if (a.projectId !== projectId && b.projectId === projectId) return 1;
    return 0;
  });

  const displayError = connectError || storeError;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setDropdownOpen((v) => !v)}
        title="SSH Connect"
        className="h-6 px-1.5 text-xs text-text-muted gap-0.5"
      >
        <Globe className="h-3 w-3" />
        SSH
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </Button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-white/[0.12] glass-elevated shadow-xl overflow-hidden">
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
            <div className="px-3 py-1.5 text-[10px] text-red-400 border-b border-white/[0.06]">
              {displayError}
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
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.06] transition-colors"
                  onClick={() => handleConnect(conn)}
                >
                  <Globe className="h-3 w-3 text-text-muted shrink-0" />
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
                    <span className="text-[9px] text-primary opacity-60">
                      project
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* New connection form */}
      <SshConnectionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
      />
    </div>
  );
}
