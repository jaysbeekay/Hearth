"use client";

import { createContext, useContext } from "react";

// Whether the signed-in member may write household records, set once in the
// (app) layout from the session role so client components deep in a page
// (document lists, banners, inbox rows) can hide write controls without the
// flag being threaded through every layer (#400). This is UI only: the
// server actions' requireUser() remains the enforcement. Outside the
// provider it fails closed: no write controls.
const CanWriteContext = createContext<boolean>(false);

export function CanWriteProvider({
  canWrite,
  children,
}: {
  canWrite: boolean;
  children: React.ReactNode;
}) {
  return <CanWriteContext.Provider value={canWrite}>{children}</CanWriteContext.Provider>;
}

export function useCanWrite(): boolean {
  return useContext(CanWriteContext);
}

/** Renders its children only for members who can write. Usable from server components too. */
export function WriteOnly({ children }: { children: React.ReactNode }) {
  return useCanWrite() ? <>{children}</> : null;
}
