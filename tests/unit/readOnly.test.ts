import { describe, expect, it, vi, beforeEach } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { canWrite, readOnlyRedirectTarget, redirectIfReadOnly } = await import("@/lib/readOnly");

type Role = "ADMIN" | "MEMBER" | "READONLY";
const as = (role: Role) => ({ user: { id: "u1", role, name: null, email: null } }) as never;

describe("redirectIfReadOnly (#400)", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("redirects a READONLY member to the given record or list", () => {
    expect(() => redirectIfReadOnly(as("READONLY"), "/contracts/abc")).toThrow("NEXT_REDIRECT:/contracts/abc");
    expect(redirect).toHaveBeenCalledWith("/contracts/abc");
  });

  it("lets ADMIN and MEMBER through", () => {
    redirectIfReadOnly(as("ADMIN"), "/contracts");
    redirectIfReadOnly(as("MEMBER"), "/contracts");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("leaves a signed-out visitor to the layout's login redirect", () => {
    redirectIfReadOnly(null, "/contracts");
    redirectIfReadOnly(undefined, "/contracts");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("readOnlyRedirectTarget returns the target only for READONLY", () => {
    expect(readOnlyRedirectTarget(as("READONLY"), "/home/1")).toBe("/home/1");
    expect(readOnlyRedirectTarget(as("MEMBER"), "/home/1")).toBeNull();
    expect(readOnlyRedirectTarget(null, "/home/1")).toBeNull();
  });

  it("canWrite is false for READONLY and signed-out, true otherwise", () => {
    expect(canWrite(as("READONLY"))).toBe(false);
    expect(canWrite(null)).toBe(false);
    expect(canWrite(as("MEMBER"))).toBe(true);
    expect(canWrite(as("ADMIN"))).toBe(true);
  });
});
