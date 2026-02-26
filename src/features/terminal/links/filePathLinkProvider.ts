import type { Terminal, IDisposable } from "@xterm/xterm";
import { resolveCanonicalFilePath } from "../../files";
import { useFileStore } from "../../files";
import { useAppStore } from "../../../stores/appStore";

export interface FilePathLinkProviderOptions {
  projectPath: string;
}

// Match file paths with optional :line and :line:col suffixes.
// Handles relative (src/foo.ts), dot-prefixed (./foo.ts, ../foo.ts), and absolute (/Users/foo.ts).
// The `\.{0,2}` quantifier covers 0 dots (bare `/`), 1 dot (`./`), and 2 dots (`../`).
// Group 1: file path, Group 2: line number, Group 3: column number
const FILE_PATH_RE =
  /(?:^|[\s'"`,=({\[])((?:\.{0,2}\/)?(?:[\w@\-.][\w@\-.]*\/)+[\w@\-.][\w@\-.]*\.[a-zA-Z]\w{0,10})(?::(\d+))?(?::(\d+))?/g;

interface FoundLink {
  startX: number;
  endX: number;
  filePath: string;
  line?: number;
  col?: number;
}

function findFileLinks(text: string): FoundLink[] {
  const results: FoundLink[] = [];
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const filePath = match[1] as string | undefined;
    if (!filePath) continue;
    const lineNum = match[2] ? parseInt(match[2], 10) : undefined;
    const colNum = match[3] ? parseInt(match[3], 10) : undefined;

    // Skip if part of a URL
    const prefixStart = Math.max(0, match.index - 8);
    const prefix = text.slice(prefixStart, match.index + 1);
    if (/https?:\/\//i.test(prefix)) continue;

    // Calculate the position of the actual file path within the match
    const fullMatchStart = match.index;
    const pathStartInMatch = match[0].indexOf(filePath);
    const pathStartCol = fullMatchStart + pathStartInMatch;

    // Total length includes :line:col suffix
    let totalLength = filePath.length;
    if (lineNum !== undefined) {
      totalLength += `:${match[2]}`.length;
      if (colNum !== undefined) {
        totalLength += `:${match[3]}`.length;
      }
    }

    results.push({
      startX: pathStartCol + 1, // 1-based
      endX: pathStartCol + totalLength + 1, // 1-based exclusive
      filePath,
      line: lineNum,
      col: colNum,
    });
  }

  return results;
}

export function createFilePathLinkProvider(
  terminal: Terminal,
  options: FilePathLinkProviderOptions,
): IDisposable {
  const { projectPath } = options;

  return terminal.registerLinkProvider({
    provideLinks(y, callback) {
      // y is 1-based
      const line = terminal.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const text = line.translateToString(true);
      const found = findFileLinks(text);

      if (found.length === 0) {
        callback(undefined);
        return;
      }

      const links = found.map((f) => ({
        range: {
          start: { x: f.startX, y },
          end: { x: f.endX, y },
        },
        text: f.filePath,
        decorations: {
          pointerCursor: true,
          underline: true,
        },
        activate: () => {
          // Resolve path
          let relativePath: string;
          if (f.filePath.startsWith("/")) {
            const resolved = resolveCanonicalFilePath(f.filePath, projectPath);
            if (!resolved) {
              console.warn("[filePathLinkProvider] Cannot resolve path outside project:", f.filePath);
              return;
            }
            relativePath = resolved;
          } else {
            relativePath = f.filePath.replace(/^\.\//, "");
          }

          // Open file viewer panel
          useAppStore.getState().setFileViewerPanelOpen(true);

          // Open file in viewer
          useFileStore
            .getState()
            .openFile(projectPath, relativePath)
            .then(() => {
              // Set scroll target if line number provided
              if (f.line != null) {
                useFileStore.getState().setScrollTarget({
                  path: relativePath,
                  line: f.line,
                  col: f.col,
                });
              }
            })
            .catch((err) => {
              console.warn("[filePathLinkProvider] Failed to open file:", relativePath, err);
            });
        },
      }));

      callback(links);
    },
  });
}
