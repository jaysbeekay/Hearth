"use client";

import { createContext, useContext } from "react";
import type { DateFormat } from "@/lib/utils";

// A native date input always renders in the *browser's* locale, so a household
// that has chosen DD/MM/YYYY still sees 07/29/2026 in every form while the
// rest of the app shows 29 Jul 2026 (#174). That isn't something CSS or an
// attribute can change — the control is drawn by the platform.
//
// DateInput echoes the chosen value back in the household's own format, so
// what you picked is unambiguous even when the picker disagrees. It reads the
// format from here rather than taking a prop, because otherwise every form and
// every page rendering one would have to thread it through.
const DateFormatContext = createContext<DateFormat>("DD/MM/YYYY");

export function DateFormatProvider({
  dateFormat,
  children,
}: {
  dateFormat: DateFormat;
  children: React.ReactNode;
}) {
  return <DateFormatContext.Provider value={dateFormat}>{children}</DateFormatContext.Provider>;
}

export function useDateFormat(): DateFormat {
  return useContext(DateFormatContext);
}
