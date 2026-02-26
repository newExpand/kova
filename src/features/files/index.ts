// Types
export type { OpenFile } from "./types";
export { MAX_OPEN_FILES } from "./types";

// Stores
export { useFileStore } from "./stores/fileStore";
export { useAgentFileTrackingStore } from "./stores/agentFileTrackingStore";
export {
  extractFilePath,
  resolveCanonicalFilePath,
  toRelativePath,
} from "./stores/agentFileTrackingStore";
export type { FileTouch, ProjectWorkingSet } from "./stores/agentFileTrackingStore";

// Components
export { FileTree } from "./components/FileTree";
export { FileTabs } from "./components/FileTabs";
export { FileBreadcrumb } from "./components/FileBreadcrumb";
export { CodeViewer } from "./components/CodeViewer";
