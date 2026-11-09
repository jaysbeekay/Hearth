import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDismissTimer } from "@/lib/dismissTimer";

describe("createDismissTimer (#618)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires after the default duration when left alone", () => {
    const onExpire = vi.fn();
    createDismissTimer(8000, onExpire);
    vi.advanceTimersByTime(7999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("does not expire while hovered, then expires after the remaining time", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    vi.advanceTimersByTime(3000);
    timer.hold("hover");
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    timer.release("hover");
    vi.advanceTimersByTime(4999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("does not expire while focus is inside, until focus leaves", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    timer.hold("focus");
    vi.advanceTimersByTime(30_000);
    expect(onExpire).not.toHaveBeenCalled();
    timer.release("focus");
    vi.advanceTimersByTime(8000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("stays paused until both hover and focus have ended", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    vi.advanceTimersByTime(2000);
    timer.hold("hover");
    timer.hold("focus");
    timer.release("hover");
    vi.advanceTimersByTime(20_000);
    expect(onExpire).not.toHaveBeenCalled();
    timer.release("focus");
    vi.advanceTimersByTime(6000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("treats repeated holds and stray releases as no-ops", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(4000, onExpire);
    timer.release("focus");
    timer.hold("hover");
    timer.hold("hover");
    vi.advanceTimersByTime(10_000);
    timer.release("hover");
    vi.advanceTimersByTime(4000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("keeps only the time left across several hold/release cycles", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    vi.advanceTimersByTime(1000);
    timer.hold("hover");
    vi.advanceTimersByTime(10_000);
    timer.release("hover");
    vi.advanceTimersByTime(2000);
    timer.hold("focus");
    vi.advanceTimersByTime(10_000);
    timer.release("focus");
    vi.advanceTimersByTime(3000);
    timer.hold("hover");
    vi.advanceTimersByTime(10_000);
    timer.release("hover");
    // 1000 + 2000 + 3000 ran, so 2000 is left.
    vi.advanceTimersByTime(1999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("a stray release while counting down doesn't push expiry back", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    vi.advanceTimersByTime(5000);
    timer.release("hover");
    timer.release("focus");
    vi.advanceTimersByTime(3000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("never fires after cancel, even if released later", () => {
    const onExpire = vi.fn();
    const timer = createDismissTimer(8000, onExpire);
    timer.hold("hover");
    timer.cancel();
    timer.release("hover");
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
