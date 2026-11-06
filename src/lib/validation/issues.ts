// #406 — the one way an action turns a failed Zod parse into the error its
// form shows. `field` is the top-level key of the first issue's path (the
// form control's `name`), so FormMessage can show the message under that
// field instead of in a banner. An issue with no path (a whole-form
// refinement) has no field and stays in the banner.

export interface IssueState {
  error: string;
  field?: string;
}

export function issueState(error: { issues: { message: string; path?: readonly PropertyKey[] }[] }): IssueState {
  const issue = error.issues[0];
  if (!issue) return { error: "Invalid input" };
  const key = issue.path?.[0];
  return typeof key === "string" && key ? { error: issue.message, field: key } : { error: issue.message };
}
