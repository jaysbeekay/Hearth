import { bannerClass, type BannerTone } from "@/lib/ui";

// #411 — the one banner: a tinted, 1px-bordered box of running text.
export function Banner({
  tone = "neutral",
  className,
  ...props
}: { tone?: BannerTone } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={bannerClass(tone, className)} {...props} />;
}
