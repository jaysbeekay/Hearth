"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { saveToInbox } from "@/lib/actions/import";
import { showToast } from "@/components/Toast";
import { compactButtonClass } from "@/lib/buttonStyles";
import { cn } from "@/lib/utils";

// Phone-only "Take photo" button, rendered in the page header next to the
// Upload entry point on the dashboard and Documents pages (#401). It
// replaces the floating camera button and "Choose file" pill (#173, #348),
// which sat over rows and buttons at every scroll position.
//
// The hidden input's accept + capture attributes open the rear camera
// directly, in mobile browsers and in the Capacitor shell's WebView alike.
// The photo goes straight to the Inbox via saveToInbox (#299), so it gets
// the same type guess as an emailed document before anyone files it.
export function TakePhotoButton() {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleCapture(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await saveToInbox(formData);
      if (result.error) {
        showToast(result.error, "error");
      } else {
        showToast("Saved to your Inbox for review.");
        router.refresh();
      }
    } catch {
      showToast("Couldn't upload that photo. Try again.", "error");
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <label
      htmlFor={inputId}
      aria-disabled={uploading}
      className={cn(
        compactButtonClass("secondary"),
        "cursor-pointer gap-2 whitespace-nowrap md:hidden has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
      )}
    >
      {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
      Take photo
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={uploading}
        aria-describedby={`${inputId}-hint`}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleCapture(file);
          }
        }}
      />
      <span id={`${inputId}-hint`} className="sr-only">
        The photo is saved to the shared household Inbox for review.
      </span>
    </label>
  );
}
