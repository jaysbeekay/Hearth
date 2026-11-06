export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    // data-field marks the field's box, and the empty data-field-error slot
    // is where FormMessage puts an action error that names this field's
    // control (#406), so the message sits under the field, not in a banner.
    <div className="flex flex-col gap-1" data-field>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div data-field-error className="empty:hidden" />
    </div>
  );
}
