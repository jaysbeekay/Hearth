import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SetupForm } from "@/components/SetupForm";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Flame size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Set up Hearth</h1>
          <p className="text-sm text-foreground/60">
            Create the first admin account for your household.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6">
          <SetupForm />
        </div>
      </div>
    </div>
  );
}
