export function isUsableOneTimeToken(input: {
  purpose: "RESET" | "INVITE";
  expectedPurpose: "RESET" | "INVITE";
  usedAt: Date | null;
  expiresAt: Date;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return (
    input.purpose === input.expectedPurpose &&
    input.usedAt === null &&
    input.expiresAt.getTime() >= now.getTime()
  );
}

export function buildConfiguredAppUrl(appUrl: string | undefined, path: string): string | null {
  if (!appUrl) return null;
  return `${appUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
