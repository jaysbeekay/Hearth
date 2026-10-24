import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

// The app's one shared display face — a warm editorial serif used for page
// titles, the wordmark, and ledger-style summary numerals. Exposed as a CSS
// variable (`.variable`, not `.className`) on <html> so it's available
// everywhere without overriding the inherited system-sans body font.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: { default: "Hearth", template: "%s · Hearth" },
  description: "Household management: contracts, products, travel, home, and more.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hearth",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#533afd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${fraunces.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
