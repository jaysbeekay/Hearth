import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Icon components can't cross the server/client boundary as props, so we
  // only pass the enabled module keys down and let Sidebar/BottomNav build
  // their own nav item list (with icons) on the client.
  const enabledModules = [...(await getEnabledModuleKeys())];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={session.user.name ?? ""}
        userEmail={session.user.email ?? ""}
        enabledModules={enabledModules}
      />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <OfflineBanner />
        <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">{children}</main>
      </div>
      <BottomNav enabledModules={enabledModules} />
    </div>
  );
}
