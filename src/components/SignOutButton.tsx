import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";

export function SignOutButton({
  className,
  iconOnly,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <form action={logout}>
      <button
        type="submit"
        aria-label={iconOnly ? "Sign out" : undefined}
        className={className ?? "flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground"}
      >
        <LogOut size={16} />
        {!iconOnly && "Sign out"}
      </button>
    </form>
  );
}
