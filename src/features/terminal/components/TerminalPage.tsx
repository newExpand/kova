import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProjectStore } from "../../project/stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import { SessionSelector } from "./SessionSelector";
import { TerminalView } from "./TerminalView";
import { Button } from "../../../components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { TerminalConfig } from "../types";

function TerminalPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );

  const status = useTerminalStore((s) => s.status);
  const sessionName = useTerminalStore((s) => s.sessionName);
  const reset = useTerminalStore((s) => s.reset);

  const [activeConfig, setActiveConfig] = useState<TerminalConfig | null>(null);

  const handleConnect = useCallback(
    (config: TerminalConfig) => {
      setActiveConfig({ ...config, projectId: projectId ?? "" });
    },
    [projectId],
  );

  const handleBack = useCallback(() => {
    reset();
    setActiveConfig(null);
    navigate(projectId ? `/projects/${projectId}` : "/");
  }, [navigate, projectId, reset]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Project not found</p>
      </div>
    );
  }

  const isConnected = status === "connected";

  return (
    <div className="flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">
            Terminal — {project.name}
          </span>
          {isConnected && sessionName && (
            <>
              <span className="text-xs text-text-muted">({sessionName})</span>
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            </>
          )}
        </div>
      </header>

      {/* Content */}
      {!activeConfig ? (
        <div className="flex-1 overflow-y-auto p-6">
          <SessionSelector
            projectName={project.name}
            onConnect={handleConnect}
            disabled={status === "connecting"}
          />
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <TerminalView config={activeConfig} />
        </div>
      )}
    </div>
  );
}

export default TerminalPage;
export { TerminalPage };
