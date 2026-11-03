import { cardClass, type CardOptions } from "@/lib/ui";

type CardTag = "div" | "section" | "article" | "li" | "ul" | "aside";

// #411 — the one card: surface, 1px border, rounded-lg, p-4, no shadow.
// For a card that is a <Link>, a <details> or a <form>, use cardClass().
export function Card({
  as: Tag = "div",
  padding,
  interactive,
  className,
  ...props
}: { as?: CardTag } & CardOptions & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cardClass({ padding, interactive }, className)} {...props} />;
}
