import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import {
  bannerClass,
  cardClass,
  emptyStateClass,
  pageShellClass,
  pillClass,
  type BannerTone,
  type PageWidth,
  type PillTone,
} from "@/lib/ui";

// #411 — the shared Card, EmptyState, Pill, Banner and PageShell. Their
// looks live in src/lib/ui.ts; use the components where you can and the
// class helpers there for elements these don't fit (a <Link>, a <form>, a
// <details>).

type BoxTag = "div" | "section" | "article" | "li" | "ul" | "ol" | "aside" | "p";

type BoxProps<T extends BoxTag> = { as?: T } & ComponentPropsWithoutRef<T>;

export function Card<T extends BoxTag = "div">({
  as,
  className,
  padding = "default",
  ...props
}: BoxProps<T> & { padding?: "default" | "none" }) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cardClass(className, { padding })} {...props} />;
}

export function EmptyState<T extends BoxTag = "div">({ as, className, ...props }: BoxProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={emptyStateClass(className)} {...props} />;
}

export function Pill({
  tone = "neutral",
  className,
  children,
  ...props
}: { tone?: PillTone; children: ReactNode } & ComponentPropsWithoutRef<"span">) {
  return (
    <span className={pillClass(tone, className)} {...props}>
      {children}
    </span>
  );
}

export function Banner<T extends BoxTag = "div">({
  as,
  tone = "neutral",
  className,
  ...props
}: BoxProps<T> & { tone?: BannerTone }) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={bannerClass(tone, className)} {...props} />;
}

export function PageShell({
  width,
  className,
  ...props
}: { width: PageWidth } & ComponentPropsWithoutRef<"div">) {
  return <div className={pageShellClass(width, className)} {...props} />;
}
