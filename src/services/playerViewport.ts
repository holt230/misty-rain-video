export interface PlayerSafeArea { top: number; right: number; bottom: number; left: number }
export interface PlayerViewportInput {
  width: number; height: number; visualHeight?: number; screenWidth?: number; screenHeight?: number;
  iosStandalone: boolean; safeArea: PlayerSafeArea;
}

/** Reserve physical safe areas before rotating a portrait-locked player. */
export function playerViewport(input: PlayerViewportInput) {
  const width = Math.max(1, input.width);
  let height = Math.max(1, input.height, input.visualHeight || 0);
  const shortSide = Math.min(input.screenWidth || width, input.screenHeight || height);
  const longSide = Math.max(input.screenWidth || width, input.screenHeight || height);
  // Web Clip can report a visual viewport shorter than its actual full-screen canvas.
  if (input.iosStandalone) {
    if (Math.abs(width - shortSide) <= 4) height = Math.max(height, longSide);
    else if (Math.abs(width - longSide) <= 4) height = Math.max(height, shortSide);
  }
  const portrait = height > width;
  const phone = input.iosStandalone && shortSide <= 500;
  const edge = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
  const gap = input.iosStandalone ? 8 : 0;
  const safe = input.safeArea;
  const insets = {
    top: Math.max(edge(safe.top) + (safe.top ? gap : 0), phone ? portrait ? 64 : 12 : 0),
    right: Math.max(edge(safe.right) + (safe.right ? gap : 0), phone && !portrait ? 64 : 0),
    bottom: Math.max(edge(safe.bottom) + (safe.bottom ? gap : 0), phone ? 24 : 0),
    left: Math.max(edge(safe.left) + (safe.left ? gap : 0), phone && !portrait ? 64 : 0)
  };
  return { width, height, insets };
}
