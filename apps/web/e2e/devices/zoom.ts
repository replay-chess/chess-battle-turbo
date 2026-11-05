// Browser zoom emulation (SPEC D7, 04 §8.1). Pure, no imports: real zoom is
// "the CSS viewport is the screen divided by the zoom, with the DPR multiplied by it".

export type Size = { width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

export function zoomViewport(base: Size, zoom: number): Size {
  return { width: Math.round(base.width / zoom), height: Math.round(base.height / zoom) };
}

export function zoomDpr(dpr: number, zoom: number): number {
  return dpr * zoom;
}

/** Emulated safe-area insets are CSS px, so they shrink with zoom too. */
export function zoomInsets(insets: Insets, zoom: number): Insets {
  return {
    top: insets.top / zoom,
    right: insets.right / zoom,
    bottom: insets.bottom / zoom,
    left: insets.left / zoom,
  };
}
