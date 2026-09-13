import React, { Suspense, lazy, useMemo } from "react";
import ostriloPoster from "@/assets/icon.png";
import { isModelCapableDocument } from "./key-handling-documents";

/**
 * `ModelViewer` statically imports `three` and `three/addons/loaders/
 * GLTFLoader.js`. Importing it statically here put an 892 KB WebGL engine into
 * the synchronous module graph of every extension document - including the one
 * that reveals an nsec and the one that asks the user to approve a signature.
 *
 * `lazy` moves it into its own chunk, reached only if a document that is
 * allowed to run WebGL actually renders the model. The lazy boundary alone is
 * necessary and not sufficient: a document that renders the model once has
 * three.js resident in its realm from then on, so `isModelCapableDocument`
 * decides whether the boundary is ever crossed at all.
 *
 * The target is `LazyModel`, not `ModelViewer`, so the `.glb` asset import sits
 * on the far side of the boundary as well.
 */
const LazyModel = lazy(() => import("./LazyModel"));

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

/**
 * Keeps the static poster on screen when the model chunk or the `.glb` fails to
 * load, rather than surfacing an error. A mascot that did not render is not
 * something to interrupt the user about, and on the lock screen an error
 * boundary message would sit directly above a password field.
 */
class ModelFallbackBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const Logo: React.FC<LogoProps> = ({
  className = "",
  size = "md",
  mode = "static",
  alt = "Ostrilo",
}) => {
  // Read once per mount. The document a realm belongs to does not change.
  const modelAllowed = useMemo(() => isModelCapableDocument(), []);

  const poster = (
    <img
      src={ostriloPoster}
      alt={alt}
      className={`${sizeClasses[size]} object-contain ${className}`}
      draggable={false}
    />
  );

  if (mode !== "model" || !modelAllowed) {
    return poster;
  }

  return (
    <div className={`relative ${sizeClasses[size]} ${className}`}>
      <ModelFallbackBoundary
        fallback={
          <img
            src={ostriloPoster}
            alt={alt}
            className="h-full w-full object-contain"
            draggable={false}
          />
        }
      >
        {/* Same element, same box, so the swap to the model shifts nothing. */}
        <Suspense
          fallback={
            <img
              src={ostriloPoster}
              alt={alt}
              className="h-full w-full object-contain"
              draggable={false}
            />
          }
        >
          <LazyModel config={DEFAULT_CONFIG} />
        </Suspense>
      </ModelFallbackBoundary>
    </div>
  );
};
