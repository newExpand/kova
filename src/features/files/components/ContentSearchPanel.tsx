import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Search,
  X,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  File,
  Hash,
  CaseSensitive,
  Regex,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useContentSearchStore } from "../stores/contentSearchStore";
import { useFileStore } from "../stores/fileStore";
import { useAppStore } from "../../../stores/appStore";
import type {
  ContentSearchFileResult,
  ContentSearchMatch,
} from "../../../lib/tauri/commands";

const SEARCH_DEBOUNCE_MS = 300;

interface ContentSearchPanelProps {
  projectPath: string;
}

export function ContentSearchPanel({ projectPath }: ContentSearchPanelProps) {
  const {
    query,
    caseSensitive,
    isRegex,
    results,
    isSearching,
    error,
    setQuery,
    toggleCaseSensitive,
    toggleRegex,
    executeSearch,
    clearResults,
  } = useContentSearchStore(
    useShallow((s) => ({
      query: s.query,
      caseSensitive: s.caseSensitive,
      isRegex: s.isRegex,
      results: s.results,
      isSearching: s.isSearching,
      error: s.error,
      setQuery: s.setQuery,
      toggleCaseSensitive: s.toggleCaseSensitive,
      toggleRegex: s.toggleRegex,
      executeSearch: s.executeSearch,
      clearResults: s.clearResults,
    })),
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  // One-shot focus trigger from Cmd+Shift+F
  const isContentSearchActive = useAppStore((s) => s.isContentSearchActive);
  const setContentSearchActive = useAppStore((s) => s.setContentSearchActive);

  useLayoutEffect(() => {
    if (isContentSearchActive) {
      setContentSearchActive(false);
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      } else {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    }
  }, [isContentSearchActive, setContentSearchActive]);

  // Debounced search execution
  useEffect(() => {
    if (!query.trim()) {
      requestIdRef.current += 1;
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      if (requestIdRef.current === currentRequestId) {
        executeSearch(projectPath);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, caseSensitive, isRegex, projectPath, executeSearch]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search Input */}
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <div className="glass-inset flex h-7 items-center gap-1.5 rounded-md px-2">
          <Search className="h-3 w-3 shrink-0 text-text-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files..."
            className="flex-1 bg-transparent text-[12px] text-text placeholder:text-text-muted outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={clearResults}
              className="shrink-0 text-text-muted hover:text-text transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Option toggles */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleCaseSensitive}
            className={`flex h-5 items-center justify-center rounded px-1 text-[10px] transition-colors ${
              caseSensitive
                ? "bg-primary/20 text-primary"
                : "text-text-muted hover:text-text hover:bg-white/[0.06]"
            }`}
            title="Match Case"
          >
            <CaseSensitive className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleRegex}
            className={`flex h-5 items-center justify-center rounded px-1 text-[10px] transition-colors ${
              isRegex
                ? "bg-primary/20 text-primary"
                : "text-text-muted hover:text-text hover:bg-white/[0.06]"
            }`}
            title="Use Regular Expression"
          >
            <Regex className="h-3.5 w-3.5" />
          </button>

          {/* Summary */}
          <div className="ml-auto text-[10px] text-text-muted">
            {isSearching && <Loader2 className="inline h-3 w-3 animate-spin" />}
            {!isSearching && results && (
              <span>
                {results.totalMatches} results in {results.totalFiles} files
                {results.durationMs > 0 && (
                  <span className="opacity-60"> ({results.durationMs}ms)</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Truncation Warning */}
      {results?.truncated && (
        <div className="px-3 py-1 text-[10px] text-amber-400/80">
          Results limited. Narrow your search for complete results.
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden glass-scrollbar">
        {results && results.files.length > 0 ? (
          results.files.map((file) => (
            <FileGroup
              key={file.path}
              file={file}
              projectPath={projectPath}
            />
          ))
        ) : (
          !isSearching &&
          query.trim() &&
          !error && (
            <div className="px-3 py-2 text-xs text-text-muted">
              No results found.
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── File Groups ──

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx":
    case "rs": case "py": case "go": case "java":
      return FileCode;
    case "json": case "toml": case "yaml": case "yml":
      return FileJson;
    case "md": case "mdx": case "txt":
      return FileText;
    case "css": case "scss": case "html":
      return Hash;
    default:
      return File;
  }
}

interface FileGroupProps {
  file: ContentSearchFileResult;
  projectPath: string;
}

function FileGroup({ file, projectPath }: FileGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const openFile = useFileStore((s) => s.openFile);
  const setScrollTarget = useFileStore((s) => s.setScrollTarget);

  const Icon = getFileIcon(file.path);
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  const handleMatchClick = useCallback(
    async (match: ContentSearchMatch) => {
      try {
        await openFile(projectPath, file.path);
        setScrollTarget({
          path: file.path,
          line: match.lineNumber,
        });
      } catch (e) {
        console.error(`[ContentSearch] Failed to open file '${file.path}':`, e);
      }
    },
    [openFile, setScrollTarget, projectPath, file.path],
  );

  return (
    <div>
      {/* File header */}
      <button
        type="button"
        onClick={() => setIsCollapsed((p) => !p)}
        className="flex w-full items-center gap-1 px-2 py-[3px] text-[11px] hover:bg-white/[0.06] transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform duration-150 ${
            !isCollapsed ? "rotate-90" : ""
          }`}
        />
        <Icon className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="truncate font-medium text-text-secondary">
          {fileName}
        </span>
        {dirPath && (
          <span className="truncate text-[10px] text-text-muted font-mono max-w-[100px]">
            {dirPath}
          </span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-white/[0.06] px-1.5 text-[10px] text-text-muted">
          {file.matches.length}
        </span>
      </button>

      {/* Match lines */}
      {!isCollapsed &&
        file.matches.map((match, idx) => (
          <MatchLine
            key={`${match.lineNumber}-${idx}`}
            match={match}
            onClick={() => handleMatchClick(match)}
          />
        ))}
    </div>
  );
}

// ── Match Line ──

interface MatchLineProps {
  match: ContentSearchMatch;
  onClick: () => void;
}

function MatchLine({ match, onClick }: MatchLineProps) {
  const { lineNumber, lineContent, matchStart, matchEnd } = match;

  // Split line content into before / matched / after
  const chars = [...lineContent];
  const before = chars.slice(0, matchStart).join("");
  const matched = chars.slice(matchStart, matchEnd).join("");
  const after = chars.slice(matchEnd).join("");

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-1.5 px-3 pl-7 py-[2px] text-[11px] hover:bg-white/[0.06] transition-colors group"
    >
      <span className="shrink-0 w-8 text-right text-[10px] text-text-muted font-mono tabular-nums">
        {lineNumber}
      </span>
      <span className="truncate font-mono text-text-secondary">
        {before}
        <span className="bg-amber-400/25 text-amber-200 rounded-sm px-[1px]">
          {matched}
        </span>
        {after}
      </span>
    </button>
  );
}
