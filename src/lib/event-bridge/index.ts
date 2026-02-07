// Central event bridge — all Tauri event listeners are registered here
// Components must NEVER call listen() directly

export function initEventBridge(): void {
  // Event listeners will be added as features are implemented
}

export function destroyEventBridge(): void {
  // Cleanup listeners
}
