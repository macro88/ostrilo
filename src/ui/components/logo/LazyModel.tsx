import ostrilohead from "@/assets/ostrilo.glb";
import SceneSetup from "./ModelViewer";

/**
 * The lazy boundary's only module.
 *
 * `Logo.tsx` lazily imports THIS, not `ModelViewer` directly, so that the
 * `.glb` asset import lives on the far side of the boundary too. Importing the
 * asset in `Logo.tsx` would put a reference to a 3D model in the eager chunk of
 * every document that renders a logo, which is every document in the extension.
 * The JavaScript being lazy while the asset it needs is eager is the shape of
 * fix that looks right and is not.
 */

interface LazyModelProps {
  config: React.ComponentProps<typeof SceneSetup>["config"];
}

export default function LazyModel({ config }: LazyModelProps) {
  return (
    <SceneSetup fileUrl={ostrilohead} textureUrl={undefined} config={config} />
  );
}
