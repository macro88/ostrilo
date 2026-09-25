import React from "react";
import ostriloMark from "@/assets/icon.png";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "hero" | "max";
  alt?: string;
}

const sizeClasses = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
  hero: "h-24 w-24",
  max: "h-full w-full",
};

export const Logo: React.FC<LogoProps> = ({
  className = "",
  size = "md",
  alt = "Ostrilo",
}) => (
  <img
    src={ostriloMark}
    alt={alt}
    className={`${sizeClasses[size]} object-contain ${className}`}
    draggable={false}
  />
);
