import { memo, useState, useCallback } from "react";
import { Play, Pencil, Trash2, Wifi } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { SshConnection, SshTestResult } from "../../../lib/tauri/commands";

interface SshConnectionCardProps {
  connection: SshConnection;
  onConnect?: (id: string) => void;
  onEdit: (connection: SshConnection) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => Promise<SshTestResult>;
}

export const SshConnectionCard = memo(function SshConnectionCard({
  connection,
  onConnect,
  onEdit,
  onDelete,
  onTest,
}: SshConnectionCardProps) {
  const [testResult, setTestResult] = useState<SshTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(connection.id);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "Test failed" });
    } finally {
      setTesting(false);
    }
  }, [connection.id, onTest]);

  const portLabel = connection.port !== 22 ? `:${connection.port}` : "";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] glass-inset px-3 py-2">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text truncate">
            {connection.name}
          </span>
          {connection.isDefault && (
            <span className="text-[10px] rounded px-1 py-0.5 bg-primary/20 text-primary">
              default
            </span>
          )}
          <span className="text-[10px] rounded px-1 py-0.5 bg-white/[0.06] text-text-muted">
            {connection.authType}
          </span>
        </div>
        <p className="text-xs text-text-muted truncate">
          {connection.username}@{connection.host}
          {portLabel}
        </p>
      </div>

      {/* Test status indicator */}
      {testResult && (
        <span
          className={`text-xs max-w-32 truncate ${testResult.success ? "text-green-400" : "text-red-400"}`}
          title={testResult.message}
        >
          {testResult.success ? "OK" : testResult.message}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-text-muted hover:text-text"
          title="Test connection"
          onClick={handleTest}
          disabled={testing}
        >
          <Wifi className="h-3.5 w-3.5" />
        </Button>
        {onConnect && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-text-muted hover:text-primary"
            title="Connect"
            onClick={() => onConnect(connection.id)}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-text-muted hover:text-text"
          title="Edit"
          onClick={() => onEdit(connection)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-text-muted hover:text-red-400"
          title="Delete"
          onClick={() => onDelete(connection.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
});
