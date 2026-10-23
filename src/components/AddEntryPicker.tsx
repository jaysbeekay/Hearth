"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Package, Boxes, Home as HomeIcon, Files, X } from "lucide-react";
import { linkButtonClass } from "@/lib/buttonStyles";
import { Dialog } from "@/components/Dialog";

interface Option {
  label: string;
  description: string;
  href: string;
  icon: typeof FileText;
}

export function AddEntryPicker({ enabledModules }: { enabledModules: string[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const options: Option[] = [
    {
      label: "Not sure? Just upload it",
      description: "Drop in a document — Hearth scans it and you confirm what it is.",
      href: "/import",
      icon: Files,
    },
    {
      label: "A bill or subscription",
      description: "Ongoing agreements — leases, subscriptions, insurance.",
      href: "/contracts/new",
      icon: FileText,
    },
    {
      label: "Something under warranty",
      description: "A single purchased item, tracked by its warranty date.",
      href: "/products/new",
      icon: Package,
    },
  ];

  if (enabledModules.includes("INVENTORY")) {
    options.push({
      label: "An item you own",
      description: "Catalogue what you own — no warranty tracking needed.",
      href: "/inventory/new",
      icon: Boxes,
    });
  }

  if (enabledModules.includes("HOME")) {
    options.push({
      label: "A property repair or improvement",
      description: "Logged against one of your properties, with receipts.",
      href: "/home",
      icon: HomeIcon,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={linkButtonClass("primary")}
      >
        <Plus size={16} />
        Add
      </button>
      {/* #342 — through the shared Dialog (#297) like every other overlay, so
          Escape closes it, focus is trapped inside and returns to the Add
          button afterwards, and the page behind it is inert. */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        panelClassName="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            What are you adding?
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2">
          {options.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-accent/50 hover:bg-accent/5"
            >
              <option.icon size={18} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-xs text-muted">{option.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </Dialog>
    </>
  );
}
