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
