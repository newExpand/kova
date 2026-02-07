import { useState, useEffect } from 'react';
import { Folder, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Project, UpdateProjectInput } from '../types';

interface ProjectEditFormProps {
  project: Project;
  onUpdate: (id: string, input: UpdateProjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const DEBOUNCE_DELAY = 300; // ms

/**
 * 인라인 프로젝트 편집 폼
 *
 * - 모달 없이 인라인 편집
 * - 300ms 디바운스 자동 저장
 * - 실패 시 롤백
 */
export function ProjectEditForm({ project, onUpdate, onDelete }: ProjectEditFormProps) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 프로젝트 변경 시 폼 상태 동기화
  useEffect(() => {
    setName(project.name);
    setPath(project.path);
  }, [project.id, project.name, project.path]);

  // 디바운스 자동 저장
  useEffect(() => {
    const hasChanges = name !== project.name || path !== project.path;
    if (!hasChanges) return;

    const timer = setTimeout(() => {
      handleSave();
    }, DEBOUNCE_DELAY);

    return () => clearTimeout(timer);
  }, [name, path]);

  const handleSave = async () => {
    if (isSaving) return;

    const input: UpdateProjectInput = {};
    if (name !== project.name) input.name = name;
    if (path !== project.path) input.path = path;

    if (Object.keys(input).length === 0) return;

    setIsSaving(true);
    setError(null);

    try {
      await onUpdate(project.id, input);
    } catch (err) {
      // 에러는 UI에 표시
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
      // 롤백
      setName(project.name);
      setPath(project.path);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        setPath(selected as string);
        setError(null);
      }
    } catch (err) {
      // 에러는 UI에 표시
      setError('디렉토리 선택 중 오류가 발생했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await onDelete(project.id);
    } catch (err) {
      // 에러는 UI에 표시
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-4">
      {/* 프로젝트 이름 */}
      <div className="grid gap-2">
        <Label htmlFor={`name-${project.id}`}>프로젝트 이름</Label>
        <Input
          id={`name-${project.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSaving || isDeleting}
        />
      </div>

      {/* 프로젝트 경로 */}
      <div className="grid gap-2">
        <Label htmlFor={`path-${project.id}`}>프로젝트 경로</Label>
        <div className="flex gap-2">
          <Input
            id={`path-${project.id}`}
            value={path}
            readOnly
            disabled={isSaving || isDeleting}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleSelectDirectory}
            disabled={isSaving || isDeleting}
            aria-label="디렉토리 선택"
          >
            <Folder className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 상태 표시 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSaving && <span className="text-sm text-muted-foreground">저장 중...</span>}
          {error && (
            <span className="text-sm text-red-500" role="alert">
              {error}
            </span>
          )}
        </div>

        {/* 삭제 버튼 */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={isSaving || isDeleting}
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          {isDeleting ? '삭제 중...' : '삭제'}
        </Button>
      </div>
    </div>
  );
}
