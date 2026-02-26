import { useRef, useEffect, useCallback } from "react";
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { glassDark } from "../themes/glassDark";
import { importLinksExtension } from "../extensions/importLinks";
import type { ScrollTarget } from "../types";

// ---------------------------------------------------------------------------
// Flash decoration (line highlight that fades via CSS animation)
// ---------------------------------------------------------------------------

const addFlashEffect = StateEffect.define<{ from: number; to: number }>();
const clearFlashEffect = StateEffect.define();

const flashMark = Decoration.line({ class: "cm-flash-line" });

const flashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    // Shift positions when document changes
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addFlashEffect)) {
        const { from, to } = effect.value;
        const ranges: ReturnType<typeof flashMark.range>[] = [];
        const doc = tr.state.doc;
        for (let pos = from; pos <= to; ) {
          const line = doc.lineAt(pos);
          ranges.push(flashMark.range(line.from));
          pos = line.to + 1;
        }
        return Decoration.set(ranges);
      }
      if (effect.is(clearFlashEffect)) {
        return Decoration.none;
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const FLASH_DURATION_MS = 1500;

interface UseCodeMirrorOptions {
  content: string;
  fileName: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
  scrollTarget?: ScrollTarget | null;
  onScrollTargetConsumed?: () => void;
  projectPath?: string;
  currentFilePath?: string;
}

// Compartment for dynamic language loading
const languageCompartment = new Compartment();

export function useCodeMirror({
  content,
  fileName,
  readOnly = false,
  onChange,
  onSave,
  scrollTarget,
  onScrollTargetConsumed,
  projectPath,
  currentFilePath,
}: UseCodeMirrorOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onScrollTargetConsumedRef = useRef(onScrollTargetConsumed);
  const projectPathRef = useRef(projectPath ?? "");
  const currentFilePathRef = useRef(currentFilePath ?? "");

  // Keep refs in sync
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onScrollTargetConsumedRef.current = onScrollTargetConsumed;
  projectPathRef.current = projectPath ?? "";
  currentFilePathRef.current = currentFilePath ?? "";

  // Create/destroy editor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        readOnly ? EditorState.readOnly.of(true) : [],
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
        saveKeymap,
        updateListener,
        languageCompartment.of([]),
        flashField,
        importLinksExtension(projectPathRef, currentFilePathRef),
        ...glassDark,
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    // Load language support async
    loadLanguage(fileName, view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, readOnly]);

  // Sync external content changes (e.g. switching files)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  // Scroll to target line and flash
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scrollTarget) return;

    const lineCount = view.state.doc.lines;
    const targetLine = Math.max(1, Math.min(scrollTarget.line, lineCount));
    const lineObj = view.state.doc.line(targetLine);

    // Scroll line to center of viewport
    view.dispatch({
      effects: EditorView.scrollIntoView(lineObj.from, { y: "center" }),
    });

    // Flash the modified line(s)
    const flashToLine = Math.min(
      targetLine + (scrollTarget.flashLines ?? 1) - 1,
      lineCount,
    );
    const flashTo = view.state.doc.line(flashToLine).to;
    view.dispatch({ effects: addFlashEffect.of({ from: lineObj.from, to: flashTo }) });

    const timerId = setTimeout(() => {
      if (view.dom.isConnected) {
        view.dispatch({ effects: clearFlashEffect.of(null) });
      }
    }, FLASH_DURATION_MS);

    // Consume AFTER successful scroll + flash dispatch
    onScrollTargetConsumedRef.current?.();

    return () => {
      clearTimeout(timerId);
    };
  }, [scrollTarget]);

  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  return { containerRef, viewRef, focus };
}

async function loadLanguage(fileName: string, view: EditorView) {
  const desc = languages.find((lang) => {
    if (lang.filename) {
      const re = new RegExp(lang.filename.source, lang.filename.flags);
      if (re.test(fileName)) return true;
    }
    if (lang.extensions) {
      const ext = fileName.split(".").pop()?.toLowerCase();
      if (ext && lang.extensions.includes(ext)) return true;
    }
    return false;
  });

  if (!desc) return;

  try {
    const support = await desc.load();
    // Ensure view still exists after async load
    if (view.dom.parentNode) {
      view.dispatch({
        effects: languageCompartment.reconfigure(support),
      });
    }
  } catch (err) {
    console.warn(`[useCodeMirror] Failed to load language for "${fileName}":`, err);
  }
}
