## REMOVED Requirements

### Requirement: Decorative 3D Model Loads Behind A Lazy Boundary

**Reason**: The 3D mascot is removed from the extension. `MODEL_CAPABLE_DOCUMENTS` was already empty, so no shipped document rendered the model; `three`, `GLTFLoader` and the `.glb` asset were carried in the build for a surface that did not exist.

**Migration**: None for users; every surface already rendered the static mascot image. The requirement "Key Handling Documents Exclude Decorative Dependencies" stays, and its build guard keeps failing if a WebGL library becomes reachable from a key-handling document again.
