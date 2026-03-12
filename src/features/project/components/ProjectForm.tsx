import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { CreateProjectInput, AgentType } from "../types";
import { AGENT_TYPES, DEFAULT_AGENT_TYPE } from "../../../lib/tauri/commands";

interface ProjectFormProps {
  onSubmit: (input: CreateProjectInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function ProjectForm({ onSubmit, onCancel, isSubmitting }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [agentType, setAgentType] = useState<AgentType>(DEFAULT_AGENT_TYPE);

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
    onSubmit({ name: name.trim(), path: path.trim(), agentType });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Name */}
      <div className="flex flex-col gap-3">
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
      <div className="flex flex-col gap-3">
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

      {/* Agent Type */}
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

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !path.trim() || isSubmitting}
        >
          {isSubmitting ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  );
}

export { ProjectForm };
