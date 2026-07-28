import { KeyRound } from "lucide-react";

// Consistent "this feature needs a server env var set" callout, visually
// distinct from an actual error state (bg-danger) so an unconfigured
// optional feature doesn't read as something broken.
export function UnconfiguredNotice({
  feature,
  envVar = "ENCRYPTION_KEY",
}: {
  feature: string;
  envVar?: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
      <KeyRound size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        Set <code className="font-mono">{envVar}</code> on the server to enable{" "}
        {feature}.
      </p>
    </div>
  );
}
