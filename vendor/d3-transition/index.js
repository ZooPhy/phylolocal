// The viewer does not create D3 transitions. d3-zoom calls interrupt() before
// direct manipulation; a lightweight cleanup is sufficient for this build.
export function interrupt(node) {
  if (node && node.__transition) delete node.__transition;
}
