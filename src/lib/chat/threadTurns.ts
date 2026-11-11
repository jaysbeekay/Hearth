// The Assistant turns in flight in this server process, one per thread.
//
// A stopped turn keeps running briefly after the client goes away, to finish
// the current round's tool results and save the stopped reply. A message sent
// straight after Stop starts a new turn on the same thread, which would read
// the history while those rows are still being written. So a new turn waits
// for the thread's previous turn first, for a bounded time. (Replay also
// copes with a half-written turn, see toReplayTurns, so the wait is a
// courtesy, not a requirement.)
const inFlight = new Map<string, Promise<void>>();

/** How long a new turn waits for the thread's previous turn. */
export const THREAD_TURN_WAIT_MS = 5_000;

/** Resolves once the thread's turn in flight (if any) has finished, or after `timeoutMs`. */
export async function waitForThreadTurn(
  threadId: string,
  timeoutMs: number = THREAD_TURN_WAIT_MS,
): Promise<void> {
  const previous = inFlight.get(threadId);
  if (!previous) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([previous, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Marks a turn on the thread as in flight. Call the returned function when it has finished. */
export function beginThreadTurn(threadId: string): () => void {
  let finish: () => void = () => {};
  const turn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  inFlight.set(threadId, turn);
  return () => {
    finish();
    if (inFlight.get(threadId) === turn) inFlight.delete(threadId);
  };
}
