/**
 * Whether the view should keep following new content after a scroll event. Only the reader scrolling up unpins:
 * browsers deliver the scroll event a frame late, after the next chunk may already have grown the page, so "not at
 * the bottom" alone can't tell reader scrolling from content growth (growth never moves scrollY up).
 */
export function nextPinned(pinned: boolean, y: number, lastY: number, atBottom: boolean): boolean {
  if (atBottom) return true;
  return y < lastY - 2 ? false : pinned;
}

/** True when the page is scrolled to (or within `tolerance` px of) its bottom. Pixel rounding differs across devices. */
export function nearBottom(scrollY: number, viewportH: number, docH: number, tolerance = 24): boolean {
  return docH - (scrollY + viewportH) <= tolerance;
}
