// The account menu's pure helpers, apart from the component so they can be
// tested without its server-action imports.

// Set at build time in next.config.ts: package.json's version and the
// commit the build came from (empty when neither GIT_SHA nor git was there).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT ?? "";

export const CHANGELOG_URL = "https://github.com/jaysbeekay/Hearth/blob/main/CHANGELOG.md";
// The same new-issue chooser the Help page links to.
export const FEEDBACK_URL = "https://github.com/jaysbeekay/Hearth/issues/new/choose";

/** "v0.20.1 (605d002)", "v0.20.1" without a commit, or "" in a build with no version. */
export function versionLabel(version = APP_VERSION, commit = APP_COMMIT): string {
  if (!version) return "";
  return commit ? `v${version} (${commit})` : `v${version}`;
}

/** "Jonathan Kaiser" → "JK", "Cher" → "C", or the email's first letter. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
    return letters.map((w) => w.charAt(0)).join("").toUpperCase();
  }
  return email.charAt(0).toUpperCase() || "?";
}
