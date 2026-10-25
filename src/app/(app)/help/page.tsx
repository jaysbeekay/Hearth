import type { Metadata } from "next";
import { linkButtonClass } from "@/lib/buttonStyles";
import { FAQ_SECTIONS, splitFaqAnswer } from "@/lib/help/faq";
import { FOOTER_NAV } from "@/components/nav-items";

export const metadata: Metadata = { title: FOOTER_NAV.help.label };

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{FOOTER_NAV.help.label}</h1>
        <p className="mt-1 text-sm text-muted">
          Answers to common questions about using Hearth. For the full user
          manual — setup, self-hosting, and every feature in more depth —
          see the{" "}
          <a
            href="https://github.com/jaysbeekay/Hearth#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            README on GitHub
          </a>
          . Can&apos;t find what you need? Report it on GitHub below.
        </p>
      </div>

      {FAQ_SECTIONS.map((section) => (
        <div key={section.heading} className="space-y-4">
          <h2 className="border-b border-border pb-2 text-sm font-semibold text-muted">
            {section.heading}
          </h2>
          <div className="space-y-2">
            {section.entries.map((entry) => (
              <details
                key={entry.q}
                className="group rounded-xl border border-border bg-surface p-4 open:pb-4"
              >
                <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
                  <span className="flex items-center justify-between gap-3">
                    {entry.q}
                    <span className="text-muted transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-foreground">
                  {splitFaqAnswer(entry.a).map((part, i) =>
                    i % 2 === 1 ? <strong key={i} className="font-medium">{part}</strong> : part,
                  )}
                </p>
              </details>
            ))}
          </div>
        </div>
      ))}

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <div className="mb-4">
          <h2 className="font-medium">Share feedback</h2>
          <p className="mt-1 text-sm text-muted">
            Found a bug, or have an idea for an improvement? Report it
            directly on Hearth&apos;s GitHub repository — pick &quot;Bug
            report&quot; or &quot;Feature request&quot; and fill in the
            template. You&apos;ll need a free GitHub account to submit it.
          </p>
        </div>
        <a
          href="https://github.com/jaysbeekay/Hearth/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer"
          className={linkButtonClass("primary")}
        >
          Report a bug or suggestion
        </a>
      </section>
    </div>
  );
}
