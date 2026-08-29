"use server";

import { auth } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";
import { env, isGithubFeedbackConfigured } from "@/lib/env";
import { formDataToStringValues } from "@/lib/form-state";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  feedbackSchema,
  type FeedbackCategory,
} from "@/lib/validation/feedback";

const FEEDBACK_FORM_FIELDS = ["category", "title", "details"];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid feedback.";
}

function issueLabel(category: FeedbackCategory) {
  return category === "BUG" ? "type:bug" : "type:enhancement";
}

function issueTitle(category: FeedbackCategory, title: string) {
  const prefix = category === "BUG" ? "Bug" : "Enhancement";
  return `${prefix}: ${title}`;
}

function issueBody(category: FeedbackCategory, details: string) {
  const heading = category === "BUG" ? "Bug report" : "Enhancement request";
  const prompt =
    category === "BUG"
      ? "Please review the description and add reproduction details if needed."
      : "Please review the proposed improvement and add acceptance details if needed.";

  return `## ${heading}

${details}

---

${prompt}
Submitted from the Hearth in-app feedback form.`;
}

export async function submitFeedback(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user)
    return { error: "You need to be signed in to send feedback." };

  const parsed = feedbackSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    details: formData.get("details"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, FEEDBACK_FORM_FIELDS),
    };
  }

  if (!isGithubFeedbackConfigured()) {
    return {
      error: "Feedback is not configured yet. Ask an administrator to set GITHUB_FEEDBACK_TOKEN.",
      values: formDataToStringValues(formData, FEEDBACK_FORM_FIELDS),
    };
  }

  const limit = consumeRateLimit("feedback", session.user.id);
  if (!limit.allowed) {
    return {
      error: `Too many feedback submissions. Please try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      values: formDataToStringValues(formData, FEEDBACK_FORM_FIELDS),
    };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.githubFeedback.repository}/issues`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.githubFeedback.token}`,
          "Content-Type": "application/json",
          "User-Agent": "Hearth feedback",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: issueTitle(parsed.data.category, parsed.data.title),
          body: issueBody(parsed.data.category, parsed.data.details),
          labels: [issueLabel(parsed.data.category)],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          error:
            "Feedback could not be submitted because the GitHub integration is not authorized.",
        };
      }
      return {
        error:
          "Feedback could not be submitted right now. Please try again later.",
      };
    }

    const issue = (await response.json()) as { number?: number };
    return {
      success: issue.number
        ? `Thanks — your feedback was filed for review as GitHub issue #${issue.number}.`
        : "Thanks — your feedback was filed for review.",
    };
  } catch {
    return {
      error:
        "Feedback could not be submitted right now. Please try again later.",
    };
  }
}
