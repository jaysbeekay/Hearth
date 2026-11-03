import { unstable_rethrow } from "next/navigation";

export const CONNECTION_ERROR = "Couldn't reach the server, so this wasn't saved. Check your connection and try again.";

/**
 * A form action whose request can't reach the server (dropped connection,
 * server restarting) throws in the browser, and React shows the error page,
 * losing whatever was typed. This turns that into an ordinary `{ error }`
 * result, so the form stays on screen with its message and can be retried.
 * Next's own control-flow errors (redirect, notFound) still propagate.
 */
export function withConnectionErrors<S extends { error?: string } | null>(
  action: (state: S, formData: FormData) => Promise<S>,
): (state: S, formData: FormData) => Promise<S> {
  return async (state, formData) => {
    try {
      return await action(state, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: CONNECTION_ERROR } as S;
    }
  };
}
