// Which item the runner pre-renders under the current board (§5.2 "Prefetch / pre-render"). The next item arrives
// through useDeferredValue, so right after an advance it still names the item that has just become current: rendering
// it would put two sibling boards under the same key (React's duplicate-key error; the runner's console guard fails it)
// and briefly mount a second, inert copy of the live position. Regression (INTEGRATE-2, T4 drill of two items).
export function preRenderedNext<T extends { itemId: string }>(currentId: string, deferredNext: T | null): T | null {
  return deferredNext && deferredNext.itemId !== currentId ? deferredNext : null;
}
