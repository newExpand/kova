import { useState } from 'react';
import { Folder } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CreateProjectInput } from '../types';
import { useProjectStore } from '../stores/projectStore';

interface ProjectFormProps {
  trigger: React.ReactNode;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

/**
 * 프로젝트 등록 대화상자
 *
 * - Dialog 모달 (shadcn/ui)
 * - 이름 입력 + 디렉토리 선택 버튼
 * - 유효성 검사: 이름 필수, 경로 필수
 * - @tauri-apps/plugin-dialog 사용 (Lead가 Cargo.toml에 추가 필요)
 */
export function ProjectForm({ trigger, onSubmit }: ProjectFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectDirectory = async () => {
    try {
      // NOTE: @tauri-apps/plugin-dialog 필요 (Lead가 package.json + Cargo.toml에 추가)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 유효성 검사
    if (!name.trim()) {
      setError('프로젝트 이름을 입력하세요.');
      return;
    }

    if (!path.trim()) {
      setError('프로젝트 경로를 선택하세요.');
      return;
    }

    // 중복 이름 검사
    const existingProjects = useProjectStore.getState().projects;
    const isDuplicate = existingProjects.some(
      (p) => p.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (isDuplicate) {
      setError('이미 같은 이름의 프로젝트가 있습니다.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({ name: name.trim(), path: path.trim() });
      // 성공 시 폼 초기화 및 닫기
      setName('');
      setPath('');
      setOpen(false);
    } catch (err) {
      // 에러는 UI에 표시
      setError(err instanceof Error ? err.message : '프로젝트 생성에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>새 프로젝트 등록</DialogTitle>
            <DialogDescription>
              Claude Code Agent Teams를 실행할 프로젝트를 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 프로젝트 이름 */}
            <div className="grid gap-2">
              <Label htmlFor="name">프로젝트 이름</Label>
              <Input
                id="name"
                placeholder="예: my-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* 프로젝트 경로 */}
            <div className="grid gap-2">
              <Label htmlFor="path">프로젝트 경로</Label>
              <div className="flex gap-2">
                <Input
                  id="path"
                  placeholder="디렉토리를 선택하세요"
                  value={path}
                  readOnly
                  disabled={isSubmitting}
                  className="flex-1"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleSelectDirectory}
                  disabled={isSubmitting}
                  aria-label="디렉토리 선택"
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <p className="text-sm text-red-500" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '생성 중...' : '등록'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
