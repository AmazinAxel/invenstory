/** True when the page is scrolled to (or within `tolerance` px of) its bottom. Pixel rounding differs across devices. */
export function nearBottom(scrollY: number, viewportH: number, docH: number, tolerance = 24): boolean {
  return docH - (scrollY + viewportH) <= tolerance;
}
