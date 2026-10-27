import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { OfflineSyncManager } from "@/components/OfflineSyncManager";
import { OfflineSessionGuard } from "@/components/OfflineSessionGuard";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ToastContainer } from "@/components/Toast";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getChatConfig, isChatConfigured } from "@/lib/ai/chat/dispatch";
import { getUserPreferences } from "@/lib/userPreferences";
import { getInboxCount } from "@/lib/documents/stats";
import { DateFormatProvider } from "@/components/DateFormatProvider";
import { CanWriteProvider } from "@/components/CanWriteProvider";
import { canWrite } from "@/lib/readOnly";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Icon components can't cross the server/client boundary as props, so we
  // only pass the enabled module keys down and let Sidebar/BottomNav build
  // their own nav item list (with icons) on the client.
  // The Inbox badge count refreshes with this layout (after a server action, router.refresh() or a full load), not live.
  const [enabledModulesSet, chatConfig, { dateFormat }, inboxCount] = await Promise.all([
    getEnabledModuleKeys(),
    getChatConfig(),
    getUserPreferences(),
    getInboxCount(),
  ]);
  const enabledModules = [...enabledModulesSet];
  const chatConfigured = isChatConfigured(chatConfig);

  return (
    <DateFormatProvider dateFormat={dateFormat}>
    <CanWriteProvider canWrite={canWrite(session)}>
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only-focusable">
        Skip to content
      </a>
      <Sidebar
        userName={session.user.name ?? ""}
        userEmail={session.user.email ?? ""}
        enabledModules={enabledModules}
        chatConfigured={chatConfigured}
        inboxCount={inboxCount}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineSessionGuard
          userId={session.user.id}
          canWrite={canWrite(session)}
          expires={session.expires}
        />
        <OfflineSyncManager />
        <OfflineBanner />
        <main id="main" className="flex-1 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>
      <BottomNav
        enabledModules={enabledModules}
        chatConfigured={chatConfigured}
        inboxCount={inboxCount}
        userName={session.user.name ?? ""}
        userEmail={session.user.email ?? ""}
      />
      <GlobalSearch />
      <ToastContainer />
    </div>
    </CanWriteProvider>
    </DateFormatProvider>
  );
}
