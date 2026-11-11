/**
 * Aborts `controller` when `signal` does (the user stopped the reply), on top
 * of whatever else aborts it (the provider call's own timeout). Returns a
 * function that stops listening, for the call's `finally`.
 */
export function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => {
    controller.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
