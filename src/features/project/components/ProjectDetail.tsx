import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../../notification/stores/notificationStore";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import { useTmuxStore } from "../../tmux/stores/tmuxStore";
import { SessionList } from "../../tmux/components/SessionList";
import { PaneCard } from "../../tmux/components/PaneCard";
import { NotificationPanel } from "../../notification/components/NotificationPanel";
import { StatusIndicator } from "./StatusIndicator";
import { COLOR_PALETTE } from "../types";
import { PageLayout } from "../../../components/layout/PageLayout";

function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );
  const selectProject = useProjectStore((s) => s.selectProject);

  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);

  const { isAvailable } = useTmuxSessions();
  const selectedSession = useTmuxStore((s) => s.selectedSession);
  const panes = useTmuxStore((s) =>
    selectedSession ? s.panes[selectedSession] : undefined,
  );
  const isLoadingPanes = useTmuxStore((s) => s.isLoadingPanes);

  useEffect(() => {
    if (projectId) {
      selectProject(projectId);
      fetchNotifications(projectId, 50);
    }
  }, [projectId, selectProject, fetchNotifications]);

  if (!project) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-text-muted">Project not found</p>
        </div>
      </PageLayout>
    );
  }

  const colorVar = COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];

  return (
    <PageLayout title={project.name}>
      <div className="space-y-6">
        {/* Project info */}
        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <div className="flex items-center gap-3">
            <div
              className="h-4 w-4 rounded-sm"
              style={{ backgroundColor: colorVar }}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-text">
                  {project.name}
                </h2>
                <StatusIndicator active={project.isActive} />
              </div>
              <p className="mt-0.5 text-xs text-text-muted font-mono">
                {project.path}
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* tmux sessions */}
          <section className="rounded-lg border border-border bg-bg-secondary">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-text">
                tmux Sessions
              </h3>
            </div>
            {isAvailable === false ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-text-muted">
                  tmux not available
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <SessionList />
                {selectedSession && (
                  <div className="border-t border-border p-3">
                    <h4 className="mb-2 text-xs font-medium text-text-secondary">
                      Panes — {selectedSession}
                    </h4>
                    {isLoadingPanes ? (
                      <span className="text-xs text-text-muted">
                        Loading panes...
                      </span>
                    ) : panes && panes.length > 0 ? (
                      <div className="grid gap-2">
                        {panes.map((pane) => (
                          <PaneCard
                            key={`${pane.windowIndex}-${pane.paneIndex}`}
                            pane={pane}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">
                        No panes
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Notification history */}
          <section className="rounded-lg border border-border bg-bg-secondary">
            <NotificationPanel />
          </section>
        </div>
      </div>
    </PageLayout>
  );
}

export { ProjectDetail };
