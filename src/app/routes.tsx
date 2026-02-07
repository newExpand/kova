import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '@/components/layout/PageLayout';
import { EnvironmentCheck } from '@/features/environment/components/EnvironmentCheck';
import { useAppStore } from '@/stores/appStore';
import { useNetworkStatus } from '@/stores/networkStore';
import {
  ProjectCard,
  ProjectGrid,
  ProjectForm,
  ProjectEditForm,
  useProjects,
  useProjectStore,
  type ProjectStatus,
} from '@/features/project';
import { UndoToast } from '@/features/project/components/UndoToast';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { Button } from '@/components/ui/button';
import { FolderPlus } from 'lucide-react';

interface UndoState {
  projectId: string;
  projectName: string;
}

function DashboardPage() {
  const { projects, isLoading, createProject, deleteProject, restoreProject } = useProjects();
  const navigate = useNavigate();
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const handleDelete = (projectId: string) => {
    deleteProject(projectId, (projectName) => {
      setUndoState({ projectId, projectName });
    });
  };

  const handleUndo = async () => {
    if (!undoState) return;
    try {
      await restoreProject(undoState.projectId);
    } finally {
      setUndoState(null);
    }
  };

  const handleDismissUndo = () => {
    setUndoState(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-secondary">프로젝트 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">프로젝트</h1>
        <ProjectForm
          trigger={
            <Button size="sm">
              <FolderPlus className="mr-1.5 h-4 w-4" />
              새 프로젝트
            </Button>
          }
          onSubmit={createProject}
        />
      </div>

      {projects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border">
          <p className="text-sm text-text-muted">첫 프로젝트를 등록하세요</p>
          <ProjectForm
            trigger={
              <Button variant="outline" size="sm">
                <FolderPlus className="mr-1.5 h-4 w-4" />
                프로젝트 등록
              </Button>
            }
            onSubmit={createProject}
          />
        </div>
      ) : (
        <ProjectGrid>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => navigate(`/project/${p.id}`)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </ProjectGrid>
      )}

      {undoState && (
        <UndoToast
          projectName={undoState.projectName}
          onUndo={handleUndo}
          onDismiss={handleDismissUndo}
        />
      )}
    </div>
  );
}

function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateProject, deleteProject, restoreProject } = useProjects();
  const project = useProjectStore((s) => s.getProjectById(id ?? ''));
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-text-muted">프로젝트를 찾을 수 없습니다</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>
          대시보드로 돌아가기
        </Button>
      </div>
    );
  }

  const handleDelete = async (projectId: string) => {
    deleteProject(projectId, (projectName) => {
      setUndoState({ projectId, projectName });
    });
    navigate('/');
  };

  const handleUndo = async () => {
    if (!undoState) return;
    try {
      await restoreProject(undoState.projectId);
    } finally {
      setUndoState(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          ← 대시보드
        </Button>
      </div>
      <ProjectEditForm
        project={project}
        onUpdate={updateProject}
        onDelete={handleDelete}
      />
      {undoState && (
        <UndoToast
          projectName={undoState.projectName}
          onUndo={handleUndo}
          onDismiss={() => setUndoState(null)}
        />
      )}
    </div>
  );
}

function AppContent() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);

  // 네트워크 상태 모니터링 시작
  useNetworkStatus();

  useGlobalShortcuts({
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onNavigateDashboard: () => navigate('/'),
    onNewProject: () => {
      setPaletteOpen(true);
    },
    onEscape: () => setPaletteOpen(false),
  });

  const paletteProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    colorIndex: p.colorIndex,
    status: 'idle' as ProjectStatus,
  }));

  return (
    <PageLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
      </Routes>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={paletteProjects}
        onSelectProject={(id) => {
          navigate(`/project/${id}`);
        }}
        onAction={(action) => {
          switch (action) {
            case 'navigate-dashboard':
              navigate('/');
              break;
            case 'open-settings':
              // 추후 설정 페이지 연결
              break;
          }
        }}
      />
    </PageLayout>
  );
}

export function AppRoutes() {
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);

  if (!onboardingComplete) {
    return <EnvironmentCheck onComplete={completeOnboarding} />;
  }

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
