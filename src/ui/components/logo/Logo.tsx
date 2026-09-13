import React from "react";
import SceneSetup from "./ModelViewer";
import ostrilohead from "@/assets/ostrilo.glb";
import ostriloPoster from "@/assets/icon.png";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "hero" | "max";
  mode?: "static" | "model";
  alt?: string;
}

const sizeClasses = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
  hero: "h-24 w-24",
  max: "h-full w-full",
};

const DEFAULT_CONFIG = {
  scale: 4.1,
  cameraZ: 7,
  fov: 42,
  ambientIntensity: 2.6,
  keyLightIntensity: 2.4,
  maxRotationDeg: 18,
  smoothness: 0.08,
  mirror: true,
  autoCenter: false,
  positionX: 0,
  positionY: -1.8,
  positionZ: 0,
  rotationX: -65,
  rotationY: 0,
  rotationZ: 0,
};

export const Logo: React.FC<LogoProps> = ({
  className = "",
  size = "md",
  mode = "static",
  alt = "Ostrilo",
}) => {
  if (mode === "model") {
    return (
      <div className={`relative ${sizeClasses[size]} ${className}`}>
        <SceneSetup
          fileUrl={ostrilohead}
          textureUrl={undefined}
          config={DEFAULT_CONFIG}
        />
      </div>
    );
  }

  return (
    <img
      src={ostriloPoster}
      alt={alt}
      className={`${sizeClasses[size]} object-contain ${className}`}
      draggable={false}
    />
  );
};
