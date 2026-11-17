export interface PlayerSafeArea { top: number; right: number; bottom: number; left: number }
export interface PlayerViewportInput {
  width: number; height: number; visualWidth?: number; visualHeight?: number;
  offsetTop?: number; offsetLeft?: number; safeArea: PlayerSafeArea;
}

/** Size playback to the visible browser viewport; safe areas only inset controls. */
export function playerViewport(input: PlayerViewportInput) {
  const edge = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
  const dimension = (visual: number | undefined, layout: number) =>
    Math.max(1, visual && Number.isFinite(visual) && visual > 0 ? visual : edge(layout));
  const safe = input.safeArea;
  return {
    width: dimension(input.visualWidth, input.width),
    height: dimension(input.visualHeight, input.height),
    top: edge(input.offsetTop || 0), left: edge(input.offsetLeft || 0),
    insets: { top: edge(safe.top), right: edge(safe.right), bottom: edge(safe.bottom), left: edge(safe.left) }
  };
}
