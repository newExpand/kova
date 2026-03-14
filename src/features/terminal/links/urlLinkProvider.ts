import type { Terminal, IBufferLine, IDisposable } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-shell";

export interface UrlLinkProviderOptions {
  /** Called when mouse enters/leaves a URL link. Used to suppress mouse
   *  escape sequences during hover so tmux copy-mode isn't triggered. */
  onLinkHoverChange?: (isHovering: boolean) => void;
}

// Match http:// and https:// URLs.
// Stops at whitespace, quotes, backticks, and common enclosing chars.
const URL_RE = /https?:\/\/[^\s'"`,<>\[\]{}()\u0080-\uFFFF]+/g;

// Trailing chars that are almost never part of a URL when at the very end
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

interface FoundUrl {
  startIdx: number; // 0-based string index
  endIdx: number; // 0-based string index (exclusive)
  url: string;
}

/** @visibleForTesting */
export function findUrls(text: string): FoundUrl[] {
  const results: FoundUrl[] = [];
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_RE.exec(text)) !== null) {
    let url = match[0];

    // Strip trailing punctuation that is unlikely part of the URL
    url = url.replace(TRAILING_PUNCT_RE, "");
    if (url.length === 0) continue;

    results.push({
      startIdx: match.index,
      endIdx: match.index + url.length,
      url,
    });
  }

  return results;
}

/**
 * Build a mapping from JS string index → terminal cell column (0-based).
 * Wide characters (CJK, emoji) occupy 2 cells but 1 string character.
 * Returns array of length textLength+1 (extra sentinel for end positions).
 */
function buildStringToCellMap(line: IBufferLine, textLength: number): number[] {
  const map: number[] = [];
  for (let x = 0; x < line.length && map.length < textLength; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const width = cell.getWidth();
    if (width === 0) continue; // continuation half of wide char
    const chars = cell.getChars();
    const charCount = chars.length || 1;
    for (let c = 0; c < charCount && map.length < textLength; c++) {
      map.push(x);
    }
  }
  // Sentinel: cell column after the last character
  if (map.length > 0) {
    const lastX = map[map.length - 1] as number;
    const lastCell = line.getCell(lastX);
    const lastW = lastCell ? Math.max(lastCell.getWidth(), 1) : 1;
    map.push(lastX + lastW);
  } else {
    map.push(0);
  }
  return map;
}

/**
 * Creates a link provider that detects http/https URLs in terminal output
 * and opens them in the system default browser on Cmd+Click.
 */
export function createUrlLinkProvider(
  terminal: Terminal,
  options?: UrlLinkProviderOptions,
): IDisposable {
  const { onLinkHoverChange } = options ?? {};

  return terminal.registerLinkProvider({
    provideLinks(y, callback) {
      try {
        const line = terminal.buffer.active.getLine(y - 1);
        if (!line) {
          callback(undefined);
          return;
        }

        const text = line.translateToString(true);
        const found = findUrls(text);

        if (found.length === 0) {
          callback(undefined);
          return;
        }

        // Map string indices to cell columns for correct positioning
        // with wide characters (Korean, CJK, emoji)
        const cellMap = buildStringToCellMap(line, text.length);

        const links = found
          .filter((f) => {
            if (f.startIdx >= cellMap.length || f.endIdx >= cellMap.length) {
              return false;
            }
            return true;
          })
          .map((f) => ({
            range: {
              start: { x: (cellMap[f.startIdx] as number) + 1, y }, // 1-based
              end: { x: (cellMap[f.endIdx] as number) + 1, y }, // 1-based exclusive
            },
            text: f.url,
            decorations: {
              pointerCursor: true,
              underline: true,
            },
            hover: () => {
              onLinkHoverChange?.(true);
            },
            leave: () => {
              onLinkHoverChange?.(false);
            },
            activate: (event: MouseEvent) => {
              // Require Cmd+Click to prevent accidental navigation
              if (!event.metaKey) return;

              open(f.url).catch((err) => {
                console.warn("[urlLinkProvider] Failed to open URL:", f.url, err);
              });
            },
          }));

        callback(links.length > 0 ? links : undefined);
      } catch (err) {
        console.error("[urlLinkProvider] Unexpected error in provideLinks:", err);
        callback(undefined);
      }
    },
  });
}
