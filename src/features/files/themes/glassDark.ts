import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Transparent background for glass effect
const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "oklch(0.90 0.02 240)",
      fontSize: "13px",
      fontFamily: "var(--font-mono, monospace)",
    },
    ".cm-content": {
      caretColor: "oklch(0.85 0.15 210)",
      padding: "8px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "oklch(0.85 0.15 210)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "oklch(0.45 0.10 210 / 0.40)",
      },
    ".cm-panels": {
      backgroundColor: "oklch(0.18 0.01 240)",
      color: "oklch(0.80 0.02 240)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid oklch(0.30 0.01 240)",
    },
    ".cm-searchMatch": {
      backgroundColor: "oklch(0.55 0.15 80 / 0.30)",
      outline: "1px solid oklch(0.55 0.15 80 / 0.50)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "oklch(0.55 0.15 80 / 0.50)",
    },
    ".cm-activeLine": {
      backgroundColor: "oklch(0.25 0.01 240 / 0.30)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "oklch(0.45 0.10 210 / 0.20)",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "oklch(0.40 0.10 210 / 0.30)",
      outline: "1px solid oklch(0.50 0.10 210 / 0.40)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "oklch(0.58 0.01 240 / 0.40)",
      border: "none",
      paddingRight: "4px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "oklch(0.70 0.02 240 / 0.60)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "oklch(0.30 0.01 240)",
      color: "oklch(0.60 0.02 240)",
      border: "none",
    },
    ".cm-tooltip": {
      backgroundColor: "oklch(0.22 0.01 240)",
      border: "1px solid oklch(0.30 0.01 240)",
      color: "oklch(0.85 0.02 240)",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "oklch(0.30 0.01 240)",
      borderBottomColor: "oklch(0.30 0.01 240)",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "oklch(0.22 0.01 240)",
      borderBottomColor: "oklch(0.22 0.01 240)",
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  // Keywords (purple)
  { tag: t.keyword, color: "oklch(0.76 0.15 300)" },
  { tag: t.controlKeyword, color: "oklch(0.76 0.15 300)" },
  { tag: t.operatorKeyword, color: "oklch(0.76 0.15 300)" },
  { tag: t.definitionKeyword, color: "oklch(0.76 0.15 300)" },
  { tag: t.moduleKeyword, color: "oklch(0.76 0.15 300)" },

  // Strings (green)
  { tag: t.string, color: "oklch(0.78 0.14 155)" },
  { tag: t.special(t.string), color: "oklch(0.78 0.14 155)" },

  // Numbers (orange)
  { tag: t.number, color: "oklch(0.80 0.14 65)" },
  { tag: t.bool, color: "oklch(0.80 0.14 65)" },

  // Functions (blue)
  { tag: t.function(t.variableName), color: "oklch(0.80 0.14 220)" },
  { tag: t.function(t.propertyName), color: "oklch(0.80 0.14 220)" },

  // Types (teal)
  { tag: t.typeName, color: "oklch(0.78 0.12 185)" },
  { tag: t.className, color: "oklch(0.78 0.12 185)" },
  { tag: t.namespace, color: "oklch(0.78 0.12 185)" },

  // Variables
  { tag: t.variableName, color: "oklch(0.88 0.04 240)" },
  { tag: t.definition(t.variableName), color: "oklch(0.88 0.06 220)" },
  { tag: t.propertyName, color: "oklch(0.82 0.08 230)" },

  // Comments (muted)
  { tag: t.comment, color: "oklch(0.50 0.02 240)", fontStyle: "italic" },
  { tag: t.lineComment, color: "oklch(0.50 0.02 240)", fontStyle: "italic" },
  { tag: t.blockComment, color: "oklch(0.50 0.02 240)", fontStyle: "italic" },

  // Operators & punctuation
  { tag: t.operator, color: "oklch(0.75 0.10 300)" },
  { tag: t.punctuation, color: "oklch(0.65 0.03 240)" },

  // Tags (HTML/JSX)
  { tag: t.tagName, color: "oklch(0.76 0.14 15)" },
  { tag: t.attributeName, color: "oklch(0.80 0.12 65)" },
  { tag: t.attributeValue, color: "oklch(0.78 0.14 155)" },

  // Regex
  { tag: t.regexp, color: "oklch(0.75 0.14 30)" },

  // Meta / preprocessor
  { tag: t.meta, color: "oklch(0.68 0.08 240)" },
  { tag: t.processingInstruction, color: "oklch(0.68 0.08 240)" },

  // Invalid
  { tag: t.invalid, color: "oklch(0.70 0.20 25)" },
]);

export const glassDark = [theme, syntaxHighlighting(highlightStyle)];
