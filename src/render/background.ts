// Remove a picture's white background (Design mode, Picture > Remove White): near-white pixels
// become see-through, with a soft edge so outlines don't look jagged.

/**
 * Make white (and near white, within `tol` of 255 on every channel) see-through, in place.
 * With `edgesOnly`, only the white joined to the picture's edges goes, so white inside the
 * picture (a highlight, the inside of a flask) stays. Pixels a little further from white are
 * faded out partly, over the next `tol` steps. RGBA pixels, top row first.
 */
export function whiteToClear(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, tol = 24, edgesOnly = true): number {
  const n = w * h;
  const dist = (i: number) => 255 - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  const soft = Math.max(1, tol);
  let take: Uint8Array;
  if (edgesOnly) {
    // flood in from the edges through pixels near white (soft edge included)
    take = new Uint8Array(n);
    const stack: number[] = [];
    const push = (i: number) => { if (!take[i] && rgba[i * 4 + 3] && dist(i) < tol + soft) { take[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop()!;
      // only go on through the truly white part; the soft edge is taken but not spread from
      if (dist(i) > tol) continue;
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
  } else take = new Uint8Array(n).fill(1);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (!take[i]) continue;
    const d = dist(i);
    if (d >= tol + soft) continue;
    const a = d <= tol ? 0 : Math.round(rgba[i * 4 + 3] * ((d - tol) / soft));
    if (a !== rgba[i * 4 + 3]) { rgba[i * 4 + 3] = a; changed++; }
  }
  return changed;
}
