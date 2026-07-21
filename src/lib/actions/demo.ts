"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";

export async function demoLogin() {
  if (!isDemoMode()) redirect("/login");
  await signIn("demo", { redirectTo: "/dashboard" });
}
