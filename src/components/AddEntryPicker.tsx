"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Package, Boxes, Home as HomeIcon, Files, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { useCanWrite } from "@/components/CanWriteProvider";
import { buttonClass, dialogPanelClass, cardClass } from "@/lib/ui";

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
      label: "A contract",
      description: "Something with a term or a recurring cost, such as insurance, a phone plan or a lease.",
      href: "/contracts/new",
      icon: FileText,
    },
    {
      label: "A warranty",
      description: "Something you bought, tracked by its warranty end date.",
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

  // Read-only members can't write, so they get no picker (#400).
  const canWrite = useCanWrite();
  if (!canWrite) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass("primary")}
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
        panelClassName={dialogPanelClass("max-w-md")}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-medium">
            What are you adding?
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={buttonClass("quiet", { icon: true }, "text-muted")}
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
              className={cardClass({ interactive: true }, "flex items-start gap-3")}
            >
              <option.icon size={16} className="mt-0.5 shrink-0 text-accent" />
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
