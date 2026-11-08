/**
 * Runs `attempt` now, then again every `retryMs` and whenever `online` fires
 * on `target`, until it resolves true. Never runs two at once; an attempt
 * that throws counts as not settled. Returns a stop function, for unmount.
 */
export function retryUntilSettled(
  attempt: () => Promise<boolean>,
  { retryMs, target }: { retryMs: number; target: EventTarget },
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    clearTimeout(timer);
    const settled = await attempt().catch(() => false);
    running = false;
    if (settled) stop();
    else if (!stopped) timer = setTimeout(() => void run(), retryMs);
  };
  const onOnline = () => void run();
  function stop() {
    stopped = true;
    clearTimeout(timer);
    target.removeEventListener("online", onOnline);
  }
  target.addEventListener("online", onOnline);
  void run();
  return stop;
}
