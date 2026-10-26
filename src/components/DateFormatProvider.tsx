"use client";

import { createContext, useContext } from "react";
import { DEFAULT_REGION, type DateFormat } from "@/lib/utils";

// A native date input always renders in the *browser's* locale, so a household
// that has chosen DD/MM/YYYY still sees 07/29/2026 in every form while the
// rest of the app shows 29 Jul 2026 (#174). That isn't something CSS or an
// attribute can change — the control is drawn by the platform.
//
// DateInput echoes the chosen value back in the household's own format, so
// what you picked is unambiguous even when the picker disagrees. It reads the
// format from here rather than taking a prop, because otherwise every form and
// every page rendering one would have to thread it through.
//
// #422 — the same goes for Due labels and timestamps (DueLabelText,
// Timestamp): they read the viewer's region and display timezone from here.
export interface DisplayPreferences {
  dateFormat: DateFormat;
  region: string;
  /** Where timestamps display (utils' displayTimeZone). Calendar dates always read in UTC. */
  timeZone: string;
}

const DisplayPreferencesContext = createContext<DisplayPreferences>({
  dateFormat: "DD/MM/YYYY",
  region: DEFAULT_REGION,
  timeZone: "UTC",
});

export function DateFormatProvider({
  dateFormat,
  region = DEFAULT_REGION,
  timeZone = "UTC",
  children,
}: {
  dateFormat: DateFormat;
  region?: string;
  timeZone?: string;
  children: React.ReactNode;
}) {
  return (
    <DisplayPreferencesContext.Provider value={{ dateFormat, region, timeZone }}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDateFormat(): DateFormat {
  return useContext(DisplayPreferencesContext).dateFormat;
}

export function useDisplayPreferences(): DisplayPreferences {
  return useContext(DisplayPreferencesContext);
}
