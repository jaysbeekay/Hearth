"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const supported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;
    let controls: { stop: () => void } | undefined;

    import("@zxing/browser")
      .then(async ({ BrowserMultiFormatReader, BarcodeFormat }) => {
        if (cancelled || !videoRef.current) return;

        const reader = new BrowserMultiFormatReader();
        reader.possibleFormats = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.ITF,
        ];

        controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (cancelled || !result) return;
            cancelled = true;
            controls?.stop();
            onDetected(result.getText());
          },
        );
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't access the camera. Check permissions and try again.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [supported, onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4">
      <div className="relative w-full max-w-sm overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="w-full" muted playsInline />
      </div>
      <p className="text-sm text-white/80">
        {!supported
          ? "Camera access isn't available here (requires HTTPS or localhost)."
          : error ?? "Point the camera at a barcode"}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
      >
        <X size={16} />
        Cancel
      </button>
    </div>
  );
}
