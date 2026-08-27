"use client";

import { useId, useState } from "react";
import { formatDate } from "@/lib/utils";
import { useDateFormat } from "@/components/DateFormatProvider";

/**
 * A native date field that also shows its value in the household's chosen
 * date format — see DateFormatProvider for why that's needed.
 *
 * Drop-in for a plain date input: every prop is forwarded, so the
 * name/id/required/className each form already sets keeps working.
 */
export function DateInput({
  defaultValue,
  onChange,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  // Several forms hold a ref to flag auto-filled values (see
  // lib/autoFillHighlight). React 19 takes ref as an ordinary prop, so it just
  // needs declaring and forwarding.
  ref?: React.Ref<HTMLInputElement>;
}) {
  const dateFormat = useDateFormat();
  const [value, setValue] = useState(typeof defaultValue === "string" ? defaultValue : "");
  const hintId = useId();

  // Only echo a complete, parseable date — half-typed states would flicker
  // nonsense underneath the field.
  const parsed = value && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null;

  return (
    <>
      <input
        {...props}
        ref={ref}
        type={"date"}
        defaultValue={defaultValue}
        aria-describedby={parsed ? hintId : props["aria-describedby"]}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event);
        }}
      />
      {parsed && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {formatDate(parsed, dateFormat)}
        </p>
      )}
    </>
  );
}
