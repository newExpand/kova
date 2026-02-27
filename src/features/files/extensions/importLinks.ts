import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, Decoration, type DecorationSet } from "@codemirror/view";
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
// Detect if click position is inside an import path string.
// Returns the path string and its character offsets within the line.
// ---------------------------------------------------------------------------

interface ImportPathRange {
  path: string;
  pathStart: number;
  pathEnd: number;
}

function getImportPathRangeAtPosition(
  lineText: string,
  posInLine: number,
): ImportPathRange | null {
  IMPORT_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_PATH_RE.exec(lineText)) !== null) {
    const path = m[2];
    if (!path) continue;
    const pathStart = m.index + m[0].indexOf(path);
    const pathEnd = pathStart + path.length;
    if (posInLine >= pathStart && posInLine <= pathEnd) {
      return { path, pathStart, pathEnd };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detect clickable range at a given document position
// Returns { from, to, importPath } or null
// ---------------------------------------------------------------------------

interface ClickableRange {
  from: number;
  to: number;
  importPath: string;
}

function getClickableRangeAtPos(
  view: EditorView,
  pos: number,
  cachedImportMap?: ImportMap | null,
): ClickableRange | null {
  if (pos < 0 || pos > view.state.doc.length) return null;
  const line = view.state.doc.lineAt(pos);
  const posInLine = pos - line.from;

  // 1. Import path string (e.g. "./foo")
  const pathRange = getImportPathRangeAtPosition(line.text, posInLine);
  if (pathRange) {
    return {
      from: line.from + pathRange.pathStart,
      to: line.from + pathRange.pathEnd,
      importPath: pathRange.path,
    };
  }

  // 2. Imported symbol name
  const word = view.state.wordAt(pos);
  if (!word) return null;
  const symbolName = view.state.sliceDoc(word.from, word.to);
  if (!symbolName) return null;

  const importMap = cachedImportMap ?? buildImportMap(view.state.doc.toString());
  const symbolImportPath = importMap[symbolName];

  if (symbolImportPath && isRelativePath(symbolImportPath)) {
    return { from: word.from, to: word.to, importPath: symbolImportPath };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hover decoration mark
// ---------------------------------------------------------------------------

const linkMark = Decoration.mark({ class: "cm-import-link" });

// ---------------------------------------------------------------------------
// ViewPlugin: tracks Cmd+hover state and applies underline decoration
// ---------------------------------------------------------------------------

function importLinkHoverPlugin(
  projectPathRef: { current: string },
  currentFilePathRef: { current: string },
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private metaDown = false;
      private lastMouseX = -1;
      private lastMouseY = -1;
      private cachedImportMap: ImportMap | null = null;

      constructor(private view: EditorView) {
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);
        this.handleBlur = this.handleBlur.bind(this);

        document.addEventListener("keydown", this.handleKeyDown);
        document.addEventListener("keyup", this.handleKeyUp);
        view.dom.addEventListener("mousemove", this.handleMouseMove);
        view.dom.addEventListener("mouseleave", this.handleMouseLeave);
        window.addEventListener("blur", this.handleBlur);
      }

      destroy() {
        document.removeEventListener("keydown", this.handleKeyDown);
        document.removeEventListener("keyup", this.handleKeyUp);
        this.view.dom.removeEventListener("mousemove", this.handleMouseMove);
        this.view.dom.removeEventListener("mouseleave", this.handleMouseLeave);
        window.removeEventListener("blur", this.handleBlur);
      }

      update(vu: ViewUpdate) {
        if (vu.docChanged) {
          this.cachedImportMap = null;
          this.decorations = Decoration.none;
        }
      }

      private handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Meta" && !this.metaDown) {
          this.metaDown = true;
          this.updateDecoration();
        }
      }

      private handleKeyUp(e: KeyboardEvent) {
        if (e.key === "Meta") {
          this.metaDown = false;
          this.clearDecoration();
        }
      }

      private handleMouseMove(e: MouseEvent) {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.metaDown = e.metaKey;
        if (this.metaDown) {
          this.updateDecoration();
        } else {
          this.clearDecoration();
        }
      }

      private handleMouseLeave() {
        this.clearDecoration();
      }

      private handleBlur() {
        this.metaDown = false;
        this.clearDecoration();
      }

      private clearDecoration() {
        if (this.decorations !== Decoration.none) {
          this.decorations = Decoration.none;
          if (this.view.dom.isConnected) this.view.dispatch({});
        }
      }

      private getHoveredRange(): ClickableRange | null {
        if (!this.metaDown || this.lastMouseX < 0) return null;
        if (!projectPathRef.current || !currentFilePathRef.current) return null;
        const pos = this.view.posAtCoords({ x: this.lastMouseX, y: this.lastMouseY });
        if (pos == null) return null;
        if (!this.cachedImportMap) {
          this.cachedImportMap = buildImportMap(this.view.state.doc.toString());
        }
        return getClickableRangeAtPos(this.view, pos, this.cachedImportMap);
      }

      private updateDecoration() {
        const range = this.getHoveredRange();
        if (range) {
          this.decorations = Decoration.set([linkMark.range(range.from, range.to)]);
          if (this.view.dom.isConnected) this.view.dispatch({});
        } else {
          this.clearDecoration();
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export function importLinksExtension(
  projectPathRef: { current: string },
  currentFilePathRef: { current: string },
): Extension {
  return [
    importLinkHoverPlugin(projectPathRef, currentFilePathRef),
    EditorView.domEventHandlers({
      mousedown(e: MouseEvent, view: EditorView) {
        if (!e.metaKey) return false;

        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;

        const projectPath = projectPathRef.current;
        const currentFilePath = currentFilePathRef.current;
        if (!projectPath || !currentFilePath) return false;

        const range = getClickableRangeAtPos(view, pos);
        if (range) {
          e.preventDefault();
          navigateToImport(projectPath, currentFilePath, range.importPath);
          return true;
        }

        return false;
      },
    }),
  ];
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
