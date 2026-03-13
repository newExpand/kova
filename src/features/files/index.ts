// Types
export type { OpenFile, ScrollTarget } from "./types";
export { MAX_OPEN_FILES } from "./types";

// Stores
export { useFileStore } from "./stores/fileStore";
export { useAgentFileTrackingStore } from "./stores/agentFileTrackingStore";
export { useContentSearchStore } from "./stores/contentSearchStore";
export {
  extractFilePath,
  resolveCanonicalFilePath,
  toRelativePath,
} from "./stores/agentFileTrackingStore";
export type { FileTouch, ProjectWorkingSet } from "./stores/agentFileTrackingStore";

// Hooks
export { useWorkingSetReconciliation } from "./hooks/useWorkingSetReconciliation";

// Components
export { FileTree } from "./components/FileTree";
export { FileTabs } from "./components/FileTabs";
export { FileBreadcrumb } from "./components/FileBreadcrumb";
export { CodeViewer } from "./components/CodeViewer";
export { ContentSearchPanel } from "./components/ContentSearchPanel";
