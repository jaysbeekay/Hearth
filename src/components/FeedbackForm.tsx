"use client";

import { useActionState } from "react";
import { submitFeedback } from "@/lib/actions/feedback";
import type { ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  SelectWrapper,
  selectClass,
} from "@/components/SelectWrapper";

export function FeedbackForm({ configured }: { configured: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    submitFeedback,
    null,
  );

  if (!configured) {
    return (
      <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
        Feedback is not available yet. Ask an administrator to configure the
        GitHub feedback integration.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="feedback-category" className="text-sm font-medium">
          What kind of feedback is this?
        </label>
        <SelectWrapper>
          <select
            id="feedback-category"
            name="category"
            defaultValue={state?.values?.category ?? "BUG"}
            className={selectClass}
          >
            <option value="BUG">Bug or issue</option>
            <option value="ENHANCEMENT">Potential enhancement</option>
          </select>
        </SelectWrapper>
      </div>

      <div className="space-y-1">
        <label htmlFor="feedback-title" className="text-sm font-medium">
          Short title
        </label>
        <input
          id="feedback-title"
          name="title"
          required
          maxLength={120}
          placeholder="For example: Calendar does not show shared trips"
          defaultValue={state?.values?.title}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="feedback-details" className="text-sm font-medium">
          Details
        </label>
        <textarea
          id="feedback-details"
          name="details"
          required
          minLength={10}
          maxLength={10_000}
          rows={6}
          placeholder="Tell us what happened, how to reproduce it, what you expected, or what you would like to improve."
          defaultValue={state?.values?.details}
          className={`${inputClass} resize-y`}
        />
      </div>

      <p className="text-xs text-foreground/50">
        Feedback is sent to the configured GitHub repository for review. Do not
        include passwords, document contents, or other sensitive household
        information.
      </p>
      <FormMessage error={state?.error} success={state?.success} />
      <SubmitButton pendingText="Sending…">Send feedback</SubmitButton>
    </form>
  );
}
