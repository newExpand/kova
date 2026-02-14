import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 backdrop-blur-[12px] px-3 py-1 text-sm text-text shadow-inner shadow-black/20 transition-all duration-200",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text",
          "placeholder:text-text-muted",
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_3px_rgba(100,140,255,0.15)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
export type { InputProps };
