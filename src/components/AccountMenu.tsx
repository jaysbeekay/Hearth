"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ScrollText, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { SignOutButton } from "@/components/SignOutButton";
import { FOOTER_NAV } from "@/components/nav-items";
import { avatarClass, menuItemClass, overlayClass } from "@/lib/ui";
import { CHANGELOG_URL, FEEDBACK_URL, initials, versionLabel } from "@/lib/account";

export function Avatar({ name, email, size = "md" }: { name: string; email: string; size?: "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={avatarClass(size)}>
      {initials(name, email)}
    </span>
  );
}

// The sidebar's account button and its popover (Settings, Changelog,
// Feedback, Sign out, and the running version). Rendered inside a
// `relative` footer, which the popover is placed against: to the right of
// the sidebar, bottom-aligned with the footer. Not "menu" role, like
// DetailOverflowMenu (#297): these are plain links and a button, without
// arrow-key menuitem semantics, so "dialog" is the honest role.
export function AccountMenu({ userName, userEmail }: { userName: string; userEmail: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popoverRef, open);

  // Close on navigation (a Settings click, Back).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
  };
  const displayName = userName || userEmail;
  const version = versionLabel();
  const settingsActive = pathname === FOOTER_NAV.settings.href || pathname.startsWith(`${FOOTER_NAV.settings.href}/`);

  return (
    <div ref={ref} className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-label={`${displayName}, account menu`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium transition-colors",
          open || settingsActive ? "bg-accent/10 text-accent" : "text-foreground hover:bg-hover",
        )}
      >
        <Avatar name={userName} email={userEmail} />
        <span className="truncate">{displayName}</span>
      </button>

      {/* Kept mounted while closed, so Sign out's unsynced-changes dialog
          (which outlives the popover) keeps its state. */}
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="Account"
        hidden={!open}
        className={overlayClass("absolute bottom-3 left-full z-40 ml-2 w-64 overflow-hidden")}
      >
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Avatar name={userName} email={userEmail} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {userName && <p className="truncate text-xs text-muted">{userEmail}</p>}
          </div>
        </div>
        {version && (
          <p className="border-b border-border px-4 py-3 text-sm text-muted">
            <span className="font-medium text-foreground">Version:</span> {version}
          </p>
        )}
        <div className="py-1">
          <Link
            href={FOOTER_NAV.settings.href}
            onClick={close}
            aria-current={settingsActive ? "page" : undefined}
            className={menuItemClass()}
          >
            <Settings size={16} className="text-muted" />
            {FOOTER_NAV.settings.label}
          </Link>
          <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" onClick={close} className={menuItemClass()}>
            <ScrollText size={16} className="text-muted" />
            Changelog
          </a>
          <a href={FEEDBACK_URL} target="_blank" rel="noreferrer" onClick={close} className={menuItemClass()}>
            <Megaphone size={16} className="text-muted" />
            Feedback
          </a>
        </div>
        {/* Capture, so the popover's focus trap lets go before Sign out's
            own dialog opens and traps focus itself. */}
        <div className="border-t border-border py-1" onClickCapture={close}>
          <SignOutButton className={menuItemClass({ destructive: true })} />
        </div>
      </div>
    </div>
  );
}
