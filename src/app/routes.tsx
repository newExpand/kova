import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProjectGrid, useProjects } from "../features/project";
import { ProjectDetail } from "../features/project";
import { PageLayout } from "../components/layout/PageLayout";
import { Button } from "../components/ui/button";
import { Plus } from "lucide-react";

// Lazy-load TerminalPage (xterm.js is in this chunk)
const TerminalPage = lazy(
  () => import("../features/terminal/components/TerminalPage"),
);

function ProjectsPage() {
  const {
    projects,
    selectedId,
    deleteProject,
    undoDelete,
    confirmDelete,
    updateProject,
    selectProject,
    isLoading,
  } = useProjects();

  if (isLoading) {
    return (
      <PageLayout title="Projects">
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-text-muted">Loading projects...</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Projects"
      actions={
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New
        </Button>
      }
    >
      <ProjectGrid
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
        onDelete={deleteProject}
        onUndoDelete={undoDelete}
        onConfirmDelete={confirmDelete}
        onUpdate={updateProject}
      />
    </PageLayout>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<ProjectDetail />} />
      <Route
        path="/projects/:projectId/terminal"
        element={
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-text-muted">Loading terminal...</p>
              </div>
            }
          >
            <TerminalPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export { AppRoutes };
