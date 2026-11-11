// #558: the aria-current value for a nav link. The link to the page being
// viewed is the current "page"; a section link whose page is an ancestor of
// the current one (Contracts on /contracts/abc, Settings on
// /settings/household) is "true", so it isn't announced as a second current
// page next to, say, the Settings tabs' own aria-current="page".
export function navCurrent(href: string, pathname: string): "page" | "true" | undefined {
  if (pathname === href) return "page";
  return pathname.startsWith(`${href}/`) ? "true" : undefined;
}
