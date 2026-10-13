// Fast walks over a parsed XML tree. Live DOM collections (getElementsByTagName, children)
// can be slow on large files in some XML engines, so these build plain arrays once.

/** Element children of `e`, in order. */
export function kids(e: Element): Element[] {
  const out: Element[] = [];
  for (let c = e.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
}

/** Every element below `root`, in document order (the same order as getElementsByTagName('*')). */
export function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (e: Element) => {
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      out.push(c);
      visit(c);
    }
  };
  visit(root);
  return out;
}
