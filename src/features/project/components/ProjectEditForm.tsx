import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { Project, UpdateProjectInput } from "../types";
import { COLOR_PALETTE } from "../types";
import { cn } from "../../../lib/utils";

interface ProjectEditFormProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, input: UpdateProjectInput) => Promise<void>;
}

function ProjectEditForm({
  project,
  open: isOpen,
  onOpenChange,
  onSave,
}: ProjectEditFormProps) {
  const [name, setName] = useState(project.name);
  const [colorIndex, setColorIndex] = useState(project.colorIndex);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave(project.id, { name: name.trim(), colorIndex });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Modify your project settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Path</Label>
            <p className="text-xs text-text-muted font-mono truncate">
              {project.path}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLOR_PALETTE.map((color, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColorIndex(i)}
                  className={cn(
                    "h-6 w-6 rounded-full transition-all",
                    colorIndex === i
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-bg-secondary scale-110"
                      : "hover:scale-105",
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={`Color ${i}`}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { ProjectEditForm };
