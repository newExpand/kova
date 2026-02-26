export const MAX_OPEN_FILES = 4;

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  isBinary: boolean;
}

export interface ScrollTarget {
  path: string;       // relative file path
  line: number;       // 1-based line number
  col?: number;       // 1-based column
  flashLines?: number; // number of lines to flash (default 1)
}
