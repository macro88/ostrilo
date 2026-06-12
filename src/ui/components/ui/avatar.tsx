import type * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { AvatarFallback } from "./avatar-fallback";
import { AvatarImage } from "./avatar-image";

interface AvatarProps
  extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  shape?: "round" | "seal";
}

function Avatar({ className, shape = "round", ref, ...props }: AvatarProps) {
  return (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden",
      shape === "seal" ? "seal rounded-none" : "rounded-full",
      className
    )}
    {...props}
  />
  );
}
Avatar.displayName = AvatarPrimitive.Root.displayName;

export { Avatar, AvatarImage, AvatarFallback };
