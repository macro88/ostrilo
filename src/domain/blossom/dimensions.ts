/**
 * The size a decoded image is drawn at so its longest edge fits `maxEdge`.
 * Never enlarges, keeps the aspect ratio, and keeps both edges at least one
 * pixel so a very thin image does not collapse to nothing.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Image dimensions must be positive whole numbers");
  }

  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
