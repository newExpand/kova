import { useState, useCallback, useRef, useEffect } from "react";
import { File, Folder } from "lucide-react";
import { useFileStore } from "../stores/fileStore";

interface InlineCreateInputProps {
  projectPath: string;
  parentDir: string;
  isDir: boolean;
  depth: number;
}

export function InlineCreateInput({
  projectPath,
  parentDir,
  isDir,
  depth,
}: InlineCreateInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const createEntry = useFileStore((s) => s.createEntry);
  const cancelInlineCreate = useFileStore((s) => s.cancelInlineCreate);

  // Auto-focus and scroll into view
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ block: "nearest" });
    }
  }, []);

  const validate = useCallback((name: string): string | null => {
    if (!name) return "Name cannot be empty";
    if (name.includes("/")) return "Name cannot contain /";
    if (name.includes("\0")) return "Name contains invalid characters";
    if (name === "." || name === "..") return "Invalid name";
    return null;
  }, []);

  const handleConfirm = useCallback(async () => {
    const trimmed = value.trim();
    const validationError = validate(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    const backendError = await createEntry(projectPath, parentDir, trimmed, isDir);
    if (backendError) {
      setError(backendError);
    }
  }, [value, validate, createEntry, projectPath, parentDir, isDir]);

  const handleCancel = useCallback(() => {
    // Don't cancel if there's a backend error being displayed — let user see it
    if (error) return;
    cancelInlineCreate(projectPath);
  }, [cancelInlineCreate, projectPath, error]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelInlineCreate(projectPath);
      }
    },
    [handleConfirm, cancelInlineCreate, projectPath],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      if (error) setError(null);
    },
    [error],
  );

  const paddingLeft = depth * 16 + 8;
  const Icon = isDir ? Folder : File;

  return (
    <div ref={containerRef} className="flex flex-col">
      <div
        className="flex items-center gap-1.5 py-[3px] bg-white/[0.04]"
        style={{ paddingLeft }}
      >
        <span className="inline-block w-3 shrink-0" />
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleCancel}
          placeholder={isDir ? "folder name" : "file name"}
          className="flex-1 bg-transparent text-[12px] text-text placeholder:text-text-muted outline-none border-b border-primary min-w-0"
        />
      </div>
      {error && (
        <div
          className="text-[10px] text-danger px-2 py-0.5"
          style={{ paddingLeft: paddingLeft + 20 }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
