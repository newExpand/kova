import { cn } from "../../../lib/utils";

interface StatusIndicatorProps {
  active: boolean;
  className?: string;
}

function StatusIndicator({ active, className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        active ? "bg-success" : "bg-text-muted",
        className,
      )}
      aria-label={active ? "Active" : "Inactive"}
    />
  );
}

export { StatusIndicator };
