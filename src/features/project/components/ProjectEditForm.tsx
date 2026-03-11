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
import type { Project, UpdateProjectInput, AgentType } from "../types";
import { COLOR_PALETTE } from "../types";
import { AGENT_TYPES, DEFAULT_AGENT_TYPE } from "../../../lib/tauri/commands";
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
  const [agentType, setAgentType] = useState<AgentType>(project.agentType || DEFAULT_AGENT_TYPE);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave(project.id, { name: name.trim(), colorIndex, agentType });
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-3">
            <Label>Path</Label>
            <p className="text-xs text-text-muted font-mono truncate">
              {project.path}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Label>AI Agent</Label>
            <div className="flex gap-2">
              {(Object.keys(AGENT_TYPES) as AgentType[]).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={agentType === type ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setAgentType(type)}
                >
                  {AGENT_TYPES[type].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Color</Label>
            <div className="flex gap-2.5 py-1">
              {COLOR_PALETTE.map((color, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColorIndex(i)}
                  className={cn(
                    "h-7 w-7 rounded-full transition-all",
                    colorIndex === i
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-transparent shadow-[0_0_8px_rgba(100,140,255,0.3)] scale-110"
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
