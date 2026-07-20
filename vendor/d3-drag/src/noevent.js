export const nonpassive = {passive: false};
export const nonpassivecapture = {capture: true, passive: false};

export function nopropagation(event) {
  event.stopImmediatePropagation();
}

export default function(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}
