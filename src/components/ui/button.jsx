import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,var(--color-primary),var(--color-primary-dim))] text-[color:var(--color-on-primary)] shadow-[0_26px_42px_rgba(52,50,46,0.08)] hover:brightness-105",
        secondary:
          "bg-[color:var(--color-primary-container)] text-[color:var(--color-on-primary-container)] hover:brightness-95",
        ghost:
          "text-[color:var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-14 px-6",
        sm: "h-10 px-4",
        lg: "h-16 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
