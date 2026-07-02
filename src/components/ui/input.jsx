import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-xl border-0 bg-[color:var(--color-surface-highest)] px-4 py-2 text-sm text-[color:var(--color-on-surface)] shadow-[0_0_0_0_rgba(62,98,132,0)] transition-shadow placeholder:text-[color:var(--color-on-surface-muted)] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(62,98,132,0.1)]",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
