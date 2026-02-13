import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { COLOR_PALETTE, MAX_COLOR_INDEX } from "../types";
import type { CreateProjectInput } from "../types";
import { cn } from "../../../lib/utils";

interface ProjectFormProps {
  onSubmit: (input: CreateProjectInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function ProjectForm({ onSubmit, onCancel, isSubmitting }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [colorIndex, setColorIndex] = useState(0);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setPath(selected);
      if (!name) {
        const folderName = selected.split("/").pop();
        if (folderName) setName(folderName);
      }
    }
  }, [name]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    onSubmit({ name: name.trim(), path: path.trim(), colorIndex });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="project-name">Project Name</Label>
        <Input
          id="project-name"
          placeholder="My Project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      {/* Path */}
      <div className="space-y-2">
        <Label htmlFor="project-path">Project Path</Label>
        <div className="flex gap-2">
          <Input
            id="project-path"
            placeholder="/path/to/project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <Button type="button" variant="outline" size="sm" onClick={handlePickFolder}>
            Browse
          </Button>
        </div>
      </div>

      {/* Color Selector */}
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

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !path.trim() || isSubmitting || colorIndex > MAX_COLOR_INDEX}
        >
          {isSubmitting ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  );
}

export { ProjectForm };
