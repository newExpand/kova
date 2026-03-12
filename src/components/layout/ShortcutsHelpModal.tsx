import { Command } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  getShortcutsByCategory,
  getCategoryLabel,
  type ShortcutDefinition,
} from "../../lib/shortcuts";

interface ShortcutsHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ShortcutKbd({ def }: { def: ShortcutDefinition }) {
  const parts: string[] = [];

  if (def.modifiers.ctrl) parts.push("⌃");
  if (def.modifiers.alt) parts.push("⌥");
  if (def.modifiers.shift) parts.push("⇧");

  const showCmdIcon = def.modifiers.meta;
  const displayKey = def.key.toUpperCase();

  return (
    <kbd className="inline-flex h-6 items-center gap-0.5 rounded-lg glass-inset border border-white/[0.10] px-2 font-mono text-[10px] text-text-secondary whitespace-nowrap">
      {showCmdIcon && <Command className="h-2.5 w-2.5" />}
      {parts.length > 0 && <span>{parts.join("")}</span>}
      <span>{displayKey}</span>
    </kbd>
  );
}

function ShortcutsHelpModal({ open, onOpenChange }: ShortcutsHelpModalProps) {
  const categories = getShortcutsByCategory();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto glass-scrollbar space-y-5 pr-2">
          {categories.map(([category, shortcuts]) => (
            <section key={category}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {getCategoryLabel(category)}
              </h3>
              <div className="space-y-1">
                {shortcuts.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm text-text">{s.label}</span>
                      {s.when && (
                        <span className="text-[10px] text-text-muted">
                          {s.when}
                        </span>
                      )}
                    </div>
                    <ShortcutKbd def={s} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ShortcutsHelpModal };
