"use client";

export function ConfirmForm({
  action,
  confirmText,
  children,
  className,
  ariaLabel,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
      onSubmit={(event) => {
        if (!window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className={className} aria-label={ariaLabel}>
        {children}
      </button>
    </form>
  );
}
