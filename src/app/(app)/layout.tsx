import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { OfflineBanner } from "@/components/OfflineBanner";
import { OfflineSyncManager } from "@/components/OfflineSyncManager";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ToastContainer } from "@/components/Toast";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getChatConfig, isChatConfigured } from "@/lib/ai/chat/dispatch";
import { getUserPreferences } from "@/lib/userPreferences";
import { DateFormatProvider } from "@/components/DateFormatProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Icon components can't cross the server/client boundary as props, so we
  // only pass the enabled module keys down and let Sidebar/BottomNav build
  // their own nav item list (with icons) on the client.
  const [enabledModulesSet, chatConfig, { dateFormat }] = await Promise.all([
    getEnabledModuleKeys(),
    getChatConfig(),
    getUserPreferences(),
  ]);
  const enabledModules = [...enabledModulesSet];
  const chatConfigured = isChatConfigured(chatConfig);

  return (
    <DateFormatProvider dateFormat={dateFormat}>
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only-focusable">
        Skip to content
      </a>
      <Sidebar
        userName={session.user.name ?? ""}
        userEmail={session.user.email ?? ""}
        enabledModules={enabledModules}
        chatConfigured={chatConfigured}
      />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <OfflineSyncManager />
        <OfflineBanner />
        <main id="main" className="flex-1 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>
      <BottomNav enabledModules={enabledModules} chatConfigured={chatConfigured} />
      <MobileNavDrawer
        userName={session.user.name ?? ""}
        userEmail={session.user.email ?? ""}
        enabledModules={enabledModules}
        chatConfigured={chatConfigured}
      />
      <GlobalSearch />
      <ToastContainer />
    </div>
    </DateFormatProvider>
  );
}
