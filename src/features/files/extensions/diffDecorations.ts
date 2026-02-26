import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Dispatch with a unified diff patch string to show decorations, or null to clear. */
export const setDiffEffect = StateEffect.define<string | null>();

// ---------------------------------------------------------------------------
// Line decoration marks
// ---------------------------------------------------------------------------

const addedLineMark = Decoration.line({ class: "cm-diff-added" });
const deletionLineMark = Decoration.line({ class: "cm-diff-has-deletion" });

// ---------------------------------------------------------------------------
// Hunk parser — extract line numbers from unified diff patch
// ---------------------------------------------------------------------------

interface ParsedHunk {
  addedLines: number[]; // 1-based line numbers in the new file
  deletionAfterLines: number[]; // 1-based: lines after which deletions occurred
}

function parseHunks(patch: string): ParsedHunk {
  const addedLines: number[] = [];
  const deletionAfterLines: number[] = [];
  const lines = patch.split("\n");
  let i = 0;

  while (i < lines.length) {
    const cur = lines[i] ?? "";
    const hunkMatch = cur.match(
      /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
    );
    if (!hunkMatch?.[1]) {
      i++;
      continue;
    }

    let newLine = parseInt(hunkMatch[1], 10);
    let pendingDeletions = 0;
    i++;

    while (i < lines.length) {
      const line = lines[i] ?? "";
      if (line.startsWith("@@") || line.startsWith("diff --git")) break;

      if (line.startsWith("+") && !line.startsWith("+++")) {
        addedLines.push(newLine);
        if (pendingDeletions > 0) {
          deletionAfterLines.push(newLine - 1 > 0 ? newLine - 1 : 1);
          pendingDeletions = 0;
        }
        newLine++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        pendingDeletions++;
      } else {
        // Context line
        if (pendingDeletions > 0) {
          deletionAfterLines.push(newLine > 1 ? newLine - 1 : 1);
          pendingDeletions = 0;
        }
        newLine++;
      }
      i++;
    }

    // Trailing deletions at end of hunk
    if (pendingDeletions > 0) {
      deletionAfterLines.push(newLine > 1 ? newLine - 1 : 1);
    }
  }

  return { addedLines, deletionAfterLines };
}

// ---------------------------------------------------------------------------
// StateField — diff decorations
// ---------------------------------------------------------------------------

export const diffField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setDiffEffect)) {
        const patch = effect.value;
        if (!patch) return Decoration.none;

        const { addedLines, deletionAfterLines } = parseHunks(patch);
        const doc = tr.state.doc;
        const ranges: ReturnType<typeof addedLineMark.range>[] = [];

        for (const lineNum of addedLines) {
          if (lineNum >= 1 && lineNum <= doc.lines) {
            ranges.push(addedLineMark.range(doc.line(lineNum).from));
          }
        }

        for (const lineNum of deletionAfterLines) {
          if (lineNum >= 1 && lineNum <= doc.lines) {
            ranges.push(deletionLineMark.range(doc.line(lineNum).from));
          }
        }

        // DecorationSet requires sorted ranges; multiple decorations at the
        // same position are allowed (e.g. added + deletion on replacement hunks).
        ranges.sort((a, b) => a.from - b.from);
        return Decoration.set(ranges, true);
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});
