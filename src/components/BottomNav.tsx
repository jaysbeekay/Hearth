"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, HelpCircle, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems, FOOTER_NAV } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { Dialog } from "@/components/Dialog";
import { InboxCountBadge, inboxLinkLabel } from "@/components/InboxCountBadge";
import { SignOutButton } from "@/components/SignOutButton";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Fixed regardless of how many modules are enabled — everything else
// (Upcoming, Spending, module items, Settings) lives in the "More" sheet so the
// bar never grows past 5 slots on small screens. Documents is promoted here
// over Upcoming since capturing/reviewing receipts is a primary, frequent
// action, while Upcoming is a secondary/glanceable view (#173). #372 may
// swap the Documents slot for Upcoming; Documents would then move into More.
const PRIMARY_HREFS = ["/dashboard", "/contracts", "/products", "/documents"];

function MoreLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center gap-1.5 whitespace-nowrap rounded-lg p-3 text-xs font-medium",
        active ? "bg-accent/10 text-accent" : "text-muted hover:bg-hover",
      )}
    >
      <Icon size={20} />
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
    isActive(FOOTER_NAV.settings.href, pathname) ||
    isActive(FOOTER_NAV.help.href, pathname);
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
              aria-label={href === "/documents" ? inboxLinkLabel(label, inboxCount) : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs font-medium",
                active ? "text-accent" : "text-muted",
              )}
            >
              <span className="relative">
                <Icon size={20} />
                {href === "/documents" && inboxBadge}
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
          aria-label="More navigation options"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs font-medium",
            overflowActive ? "text-accent" : "text-muted",
          )}
        >
          <MoreHorizontal size={20} />
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
        panelClassName="max-h-[90dvh] w-full overflow-y-auto rounded-t-lg border-t border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
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
              className="flex size-11 items-center justify-center rounded-full hover:bg-hover"
            >
              <X size={20} />
            </button>
          </div>
          {overflowModules.length > 0 && (
            <>
              <p className="mb-1.5 text-xs font-medium text-muted">Modules</p>
              <div className="mb-3 grid grid-cols-3 gap-2">
                {overflowModules.map(({ href, label, icon }) => (
                  <MoreLink key={href} href={href} label={label} icon={icon} active={isActive(href, pathname)} />
                ))}
              </div>
            </>
          )}

          <p className="mb-1.5 text-xs font-medium text-muted">Tools</p>
          <div className="grid grid-cols-3 gap-2">
            {overflowTools.map(({ href, label, icon }) => (
              <MoreLink key={href} href={href} label={label} icon={icon} active={isActive(href, pathname)} />
            ))}
            <MoreLink
              href={FOOTER_NAV.settings.href}
              label={FOOTER_NAV.settings.label}
              icon={Settings}
              active={isActive(FOOTER_NAV.settings.href, pathname)}
            />
            <MoreLink
              href={FOOTER_NAV.help.href}
              label={FOOTER_NAV.help.label}
              icon={HelpCircle}
              active={isActive(FOOTER_NAV.help.href, pathname)}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-muted">{userEmail}</p>
            </div>
            <SignOutButton className="flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm text-muted hover:text-foreground" />
          </div>
        </>
      </Dialog>
    </>
  );
}
