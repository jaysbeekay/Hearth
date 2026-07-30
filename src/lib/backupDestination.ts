// A single explicit backup destination choice — kept in its own module (no
// server-only imports) so both the client-side settings form and server
// components/actions can import it without pulling Prisma into the client bundle.
export type BackupDestinationChoice = "NONE" | "LOCAL" | "S3" | "SFTP";

export const BACKUP_DESTINATION_LABELS: Record<BackupDestinationChoice, string> = {
  NONE: "Not configured",
  LOCAL: "Local filesystem",
  S3: "S3-compatible storage",
  SFTP: "SFTP",
};
