/** Layout dimensions stay in player coordinates when the whole surface is rotated. */
export function playerViewportSize(video: HTMLVideoElement) {
  const stage=video.parentElement || video, rect=stage.getBoundingClientRect();
  return {width:stage.clientWidth || rect.width,height:stage.clientHeight || rect.height};
}

/** Visible picture coordinates inside the stage, excluding contain-mode letterboxes. */
export function pictureBounds(width: number, height: number, videoWidth: number, videoHeight: number, fit: string) {
  const scale = videoWidth > 0 && videoHeight > 0 ? Math.min(width / videoWidth, height / videoHeight) : 1;
  const imageHeight = fit === 'contain' && videoHeight > 0 ? videoHeight * scale : height;
  const imageWidth = fit === 'contain' && videoWidth > 0 ? videoWidth * scale : width;
  return { left: (width-imageWidth)/2, top: (height-imageHeight)/2, width: imageWidth, height: imageHeight };
}
/** Place captions inside the visible image, including portrait fullscreen letterboxing. */
export function captionLayout(width: number, height: number, videoWidth: number, videoHeight: number, fit: string, controlsInset = 0) {
  const picture = pictureBounds(width,height,videoWidth,videoHeight,fit);
  const imageHeight = picture.height, imageWidth = picture.width;
  const margin = Math.max(8, imageHeight * .04);
  return {
    bottom: `${Math.max((height - imageHeight) / 2 + margin, controlsInset + 8)}px`,
    width: `${Math.max(0, imageWidth * .92)}px`,
    fontSize: `${Math.max(14, Math.min(28, imageHeight * .055))}px`,
  };
}
