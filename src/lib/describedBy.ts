// #615 — aria-describedby is a space-separated list of ids, and several
// things add to it: a Field's hint, an action error under the field (#406),
// an auto-fill note. Each adds and removes only its own id, so none of them
// overwrites what another put there.

function ids(value: string | null | undefined): string[] {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

/**
 * `value` with `id` added: at the front when `first` (an error, read before
 * anything else), otherwise at the end. An id already present stays where it is.
 */
export function addDescribedBy(value: string | null | undefined, id: string, first = false): string {
  const current = ids(value);
  if (current.includes(id)) return current.join(" ");
  return (first ? [id, ...current] : [...current, id]).join(" ");
}

/** `value` without `id`, or null when nothing is left (remove the attribute). */
export function removeDescribedBy(value: string | null | undefined, id: string): string | null {
  const rest = ids(value).filter((existing) => existing !== id);
  return rest.length ? rest.join(" ") : null;
}

/** Applies `removeDescribedBy` to an element's attribute. */
export function dropDescribedBy(el: Element, id: string): void {
  const rest = removeDescribedBy(el.getAttribute("aria-describedby"), id);
  if (rest) el.setAttribute("aria-describedby", rest);
  else el.removeAttribute("aria-describedby");
}

/** The id of a Field's hint, derived from the id of the control it describes. */
export function fieldHintId(controlId: string): string {
  return `${controlId}-hint`;
}
