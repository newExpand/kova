import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { resolveImportPath } from "../../../lib/tauri/commands";
import { useFileStore } from "../stores/fileStore";

// ---------------------------------------------------------------------------
// Import statement regex patterns
// ---------------------------------------------------------------------------

/** Match: from "path" / from 'path' — captures the path inside quotes */
const IMPORT_PATH_RE =
  /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)(['"])(\.{0,2}\/[^'"]+)\1/g;

/** Named import: import { a, b } from "path" */
const NAMED_IMPORT_RE =
  /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Default or namespace import: import Foo from "path" / import * as Foo from "path" */
const SIMPLE_IMPORT_RE =
  /import\s+(?:\*\s*as\s+)?(\w+)\s+from\s*['"]([^'"]+)['"]/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ImportMap = Record<string, string>; // symbol → import path

function isRelativePath(path: string): boolean {
  return path.startsWith(".") || path.startsWith("/");
}

/** Exec a global regex repeatedly, collecting m[1] → m[2] entries into the map. */
function collectMatches(
  re: RegExp,
  text: string,
  map: ImportMap,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] && m[2]) map[m[1]] = m[2];
  }
}

// ---------------------------------------------------------------------------
// Build symbol → import path map from document content
// ---------------------------------------------------------------------------

function buildImportMap(docText: string): ImportMap {
  const map: ImportMap = {};

  // Named imports: extract each symbol from the braces
  NAMED_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAMED_IMPORT_RE.exec(docText)) !== null) {
    const symbols = m[1];
    const path = m[2];
    if (!symbols || !path) continue;
    for (const part of symbols.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Handle "originalName as alias"
      const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
      const name = asMatch ? asMatch[2] : trimmed.match(/^(\w+)/)?.[1];
      if (name) map[name] = path;
    }
  }

  // Default and namespace imports (both capture name in group 1, path in group 2)
  collectMatches(SIMPLE_IMPORT_RE, docText, map);

  return map;
}

// ---------------------------------------------------------------------------
// Detect if click position is inside an import path string
// ---------------------------------------------------------------------------

function getImportPathAtPosition(
  lineText: string,
  posInLine: number,
): string | null {
  IMPORT_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_PATH_RE.exec(lineText)) !== null) {
    const path = m[2];
    if (!path) continue;
    // Find path's position in the full match
    const pathStart = m.index + m[0].indexOf(path);
    const pathEnd = pathStart + path.length;
    if (posInLine >= pathStart && posInLine <= pathEnd) {
      return path;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export function importLinksExtension(
  projectPathRef: { current: string },
  currentFilePathRef: { current: string },
): Extension {
  return EditorView.domEventHandlers({
    mousedown(e: MouseEvent, view: EditorView) {
      if (!e.metaKey) return false;

      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;

      const line = view.state.doc.lineAt(pos);
      const posInLine = pos - line.from;
      const projectPath = projectPathRef.current;
      const currentFilePath = currentFilePathRef.current;

      if (!projectPath || !currentFilePath) return false;

      // 1. Check if click is on an import path string
      // IMPORT_PATH_RE already constrains to relative/absolute paths
      const importPath = getImportPathAtPosition(line.text, posInLine);
      if (importPath) {
        e.preventDefault();
        navigateToImport(projectPath, currentFilePath, importPath);
        return true;
      }

      // 2. Check if click is on a symbol that was imported
      const word = view.state.wordAt(pos);
      if (!word) return false;

      const symbolName = view.state.sliceDoc(word.from, word.to);
      if (!symbolName) return false;

      const docText = view.state.doc.toString();
      const importMap = buildImportMap(docText);
      const symbolImportPath = importMap[symbolName];

      if (symbolImportPath && isRelativePath(symbolImportPath)) {
        e.preventDefault();
        navigateToImport(projectPath, currentFilePath, symbolImportPath);
        return true;
      }

      return false;
    },
  });
}

// ---------------------------------------------------------------------------
// Navigation helper
// ---------------------------------------------------------------------------

function navigateToImport(
  projectPath: string,
  currentFile: string,
  importPath: string,
): void {
  resolveImportPath(projectPath, currentFile, importPath)
    .then((resolvedPath) => {
      if (!resolvedPath) {
        console.warn("[importLinks] Could not resolve:", importPath);
        return;
      }
      useFileStore.getState().openFile(projectPath, resolvedPath);
    })
    .catch((err) => {
      console.error("[importLinks] IPC error resolving import:", importPath, err);
    });
}
