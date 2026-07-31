"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera } from "lucide-react";

// A persistent one-tap capture action on mobile, since photographing and
// uploading a receipt/document is a primary, frequent action for this app,
// not something that should require digging through "More" first (#173).
// Hidden on /import itself since the user is already there, and on every
// /new and /edit form route — those routes end in a fixed-position submit
// button at roughly this same screen position, which the FAB would cover.
export function MobileUploadFab() {
  const pathname = usePathname();
  if (pathname.startsWith("/import")) return null;
  if (pathname.endsWith("/new") || pathname.endsWith("/edit")) return null;

  return (
    <Link
      href="/import"
      aria-label="Upload a document"
      className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg hover:opacity-90 md:hidden"
    >
      <Camera size={24} />
    </Link>
  );
}
