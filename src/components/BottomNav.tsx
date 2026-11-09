"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems, isFooterNavActive, footerNavCurrent, FOOTER_NAV_ENTRIES } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { Dialog } from "@/components/Dialog";
import { InboxCountBadge, inboxLinkLabel } from "@/components/InboxCountBadge";
import { SignOutButton } from "@/components/SignOutButton";
import { Avatar } from "@/components/AccountMenu";
import { versionLabel } from "@/lib/account";
import { sheetClass, buttonClass, tabActiveClass } from "@/lib/ui";
import { navCurrent } from "@/lib/navCurrent";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Fixed regardless of how many modules are enabled — everything else
// (Documents, Spending, module items, Settings) lives in the "More" sheet so
// the bar never grows past 5 slots on small screens. #372: Upcoming takes the
// fourth slot ("when is X due?" is what most members open the app for);
// Documents, with its Inbox count, is one tap away in More, and capturing a
// document stays on the camera button.
const PRIMARY_HREFS = ["/dashboard", "/contracts", "/products", "/calendar"];

function MoreLink({
  href,
  label,
  icon: Icon,
  active,
  ariaLabel,
  badge,
  current,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  ariaLabel?: string;
  badge?: React.ReactNode;
  /** aria-current: navCurrent() for most links, footerNavCurrent() for the footer's. */
  current: "page" | "true" | undefined;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={current}
      className={cn(
        "flex flex-col items-center gap-1.5 whitespace-nowrap rounded-lg p-3 text-xs font-medium",
        active ? cn(tabActiveClass, "bg-accent/10") : "text-muted hover:bg-hover",
      )}
    >
      <span className="relative">
        <Icon size={20} />
        {badge}
      </span>
      {label}
    </Link>
  );
}

// The only navigation on phones (#407): this bar plus its More sheet. The
// sheet holds every destination the bar doesn't, plus the account's Sign
// out, so it matches the desktop sidebar. Upload and the Inbox aren't nav
// entries: Upload is a page-header action on Dashboard and Documents (#401),
// and the Inbox is a tab on Documents, whose bar tab carries its count.
export function BottomNav({
  enabledModules,
  chatConfigured,
  inboxCount,
  userName,
  userEmail,
}: {
  enabledModules: ModuleKey[];
  chatConfigured: boolean;
  inboxCount: number;
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = getNavItems(new Set(enabledModules), chatConfigured);
  const version = versionLabel();

  // Close automatically on route change (link click).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }

  const primary = PRIMARY_HREFS.map((href) => items.find((i) => i.href === href)).filter(
    (i): i is NonNullable<typeof i> => i != null,
  );
  const overflow = items.filter((i) => !PRIMARY_HREFS.includes(i.href));
  const overflowModules = overflow.filter((i) => i.group === "modules");
  const overflowTools = overflow.filter((i) => i.group === "tools");
  const overflowActive =
    overflow.some((i) => isActive(i.href, pathname)) ||
    FOOTER_NAV_ENTRIES.some(({ key }) => isFooterNavActive(key, pathname));
  const inboxBadge = <InboxCountBadge count={inboxCount} className="absolute -right-3 -top-1.5" />;

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={navCurrent(href, pathname)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs font-medium",
                active ? tabActiveClass : "text-muted",
              )}
            >
              <span className="relative">
                <Icon size={20} />
              </span>
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setMoreOpen(true);
          }}
          aria-label={inboxCount > 0 ? `More navigation options, ${inboxLinkLabel("Documents", inboxCount)}` : "More navigation options"}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs font-medium",
            overflowActive ? tabActiveClass : "text-muted",
          )}
        >
          <span className="relative">
            <MoreHorizontal size={20} />
            {inboxBadge}
          </span>
          More
        </button>
      </nav>

      <Dialog
        open={moreOpen}
        onClose={() => {
          setMoreOpen(false);
        }}
        label="More navigation options"
        backdropClassName="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
        panelClassName={sheetClass("max-h-[90dvh] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]")}
      >
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">More</span>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
              }}
              aria-label="Close"
              className={buttonClass("quiet", { icon: true })}
            >
              <X size={20} />
            </button>
          </div>
          {overflowModules.length > 0 && (
            <>
              <p className="mb-1.5 text-xs font-medium text-muted">Modules</p>
              <div className="mb-3 grid grid-cols-3 gap-2">
                {overflowModules.map(({ href, label, icon }) => (
                  <MoreLink
                    key={href}
                    href={href}
                    label={label}
                    icon={icon}
                    active={isActive(href, pathname)}
                    current={navCurrent(href, pathname)}
                  />
                ))}
              </div>
            </>
          )}

          <p className="mb-1.5 text-xs font-medium text-muted">Tools</p>
          <div className="grid grid-cols-3 gap-2">
            {overflowTools.map(({ href, label, icon }) => (
              <MoreLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={isActive(href, pathname)}
                current={navCurrent(href, pathname)}
                ariaLabel={href === "/documents" ? inboxLinkLabel(label, inboxCount) : undefined}
                badge={href === "/documents" ? inboxBadge : undefined}
              />
            ))}
            {FOOTER_NAV_ENTRIES.map((entry) => {
              const current = footerNavCurrent(entry, pathname);
              return (
                <MoreLink
                  key={entry.key}
                  href={entry.href}
                  label={entry.label}
                  icon={entry.icon}
                  active={current !== undefined}
                  current={current}
                />
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={userName} email={userEmail} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="truncate text-xs text-muted">{userEmail}</p>
              </div>
            </div>
            <SignOutButton className="flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm text-muted hover:text-foreground" />
          </div>
          {version && <p className="mt-2 text-xs text-muted">Version {version}</p>}
        </>
      </Dialog>
    </>
  );
}
