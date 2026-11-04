"use client";

import { X } from "lucide-react";
import { useDismissible } from "@/lib/useDismissible";
import { bannerClass, buttonClass } from "@/lib/ui";

// #372 — a member who just accepted an invite lands on Upcoming with this:
// whose data it is and what their role lets them do (the role descriptions
// were otherwise only shown to the admin who invited them). It shows only on
// that first landing (?welcome=1), so moving on without closing it is fine:
// it's a hello, not a notice they have to acknowledge. Closing it hides it
// for that user on this device if they reload the landing page.
export function WelcomeBanner({
  userId,
  roleLabel,
  roleDescription,
  memberCount,
}: {
  userId: string;
  roleLabel: string;
  roleDescription: string;
  memberCount: number;
}) {
  const [dismissed, dismiss] = useDismissible(`hearth:welcome-banner:${userId}`);
  if (dismissed) return null;

  const article = /^[AEIOU]/i.test(roleLabel) ? "an" : "a";
  return (
    <section role="status" className={bannerClass("neutral", "relative pr-10")}>
      <button
        type="button"
        aria-label="Dismiss welcome"
        onClick={dismiss}
        className={buttonClass("quiet", { icon: true }, "absolute right-2 top-2")}
      >
        <X size={16} />
      </button>
      <p className="font-medium">
        Welcome. You&apos;re {article} {roleLabel} of this household.
      </p>
      <p>
        Everything here is shared with all {memberCount} {memberCount === 1 ? "member" : "members"}.{" "}
        {roleDescription} Upcoming shows what&apos;s due next.
      </p>
    </section>
  );
}
