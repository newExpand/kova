import { useRef, useEffect, useCallback } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { glassDark } from "../themes/glassDark";

interface UseCodeMirrorOptions {
  content: string;
  fileName: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
}

// Compartment for dynamic language loading
const languageCompartment = new Compartment();

export function useCodeMirror({
  content,
  fileName,
  readOnly = false,
  onChange,
  onSave,
}: UseCodeMirrorOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  // Keep refs in sync
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

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
  } catch {
    // Language load failure is non-critical
  }
}
