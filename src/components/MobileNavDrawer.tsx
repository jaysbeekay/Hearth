"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { SignOutButton } from "@/components/SignOutButton";

const OPEN_EVENT = "hearth:open-nav-drawer";
// Width from the left screen edge a touch can start in and still count as
// an edge-swipe — kept narrow so it stays clear of interactive content and
// roughly matches the zone native OS back-gestures claim on Android/iOS.
// Whether the OS intercepts the touch before this handler ever sees it
// depends on the platform/WebView and can't be verified without a real
// device; the visible trigger button in TopBar is the reliable fallback.
const EDGE_ZONE = 24;
const OPEN_THRESHOLD = 60;

export function openMobileNavDrawer() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNavDrawer({
  userName,
  userEmail,
  enabledModules,
}: {
  userName: string;
  userEmail: string;
  enabledModules: ModuleKey[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = getNavItems(new Set(enabledModules));
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Directionally this can't collide with SwipeableListItem's own drag
  // handling — that only reacts to leftward motion (delta < 0), while this
  // only opens on a rightward drag that starts within EDGE_ZONE of the
  // screen edge, well clear of the reveal panel any list card exposes.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch" || open) return;
      if (e.clientX > EDGE_ZONE) return;
      startX.current = e.clientX;
      dragging.current = true;
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging.current || startX.current == null) return;
      if (e.clientX - startX.current >= OPEN_THRESHOLD) {
        dragging.current = false;
        startX.current = null;
        setOpen(true);
      }
    }
    function onPointerUp() {
      dragging.current = false;
      startX.current = null;
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex bg-black/40 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      onClick={close}
    >
      <div
        className="flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Flame size={20} className="text-accent" />
            <span className="text-lg font-semibold">Hearth</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation menu"
            className="flex size-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                isActive(href, pathname)
                  ? "bg-accent/10 text-accent"
                  : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-3 py-3">
          <Link
            href="/settings"
            onClick={close}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
              isActive("/settings", pathname)
                ? "bg-accent/10 text-accent"
                : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
            )}
          >
            <Settings size={18} />
            Settings
          </Link>
          <div className="mt-2 px-3">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted">{userEmail}</p>
            <SignOutButton className="mt-2 flex items-center gap-2 text-sm text-muted hover:text-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}
