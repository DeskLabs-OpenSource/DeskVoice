import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

const HOUR = 60 * 60 * 1000;

describe("createRateLimiter", () => {
  it("forgets keys whose last attempt left the longest window, so the map does not grow without a ceiling", () => {
    const limiter = createRateLimiter();
    const t0 = new Date("2001-01-01T12:00:00.000Z");
    for (let index = 0; index < 300; index += 1) limiter.take(`pair:guess-${index}@example.test|198.51.100.1`, t0, { max: 5, windowMs: HOUR });
    expect(limiter.size()).toBeGreaterThan(0);

    // Depois da maior janela em uso, a varredura seguinte apaga todas as chaves antigas.
    const later = new Date(t0.getTime() + HOUR);
    for (let index = 0; index < 256; index += 1) limiter.take("pair:same@example.test|198.51.100.2", later, { max: 1000, windowMs: HOUR });
    expect(limiter.size()).toBe(1);
  });

  it("keeps a key that still has an attempt inside its window", () => {
    const limiter = createRateLimiter();
    const t0 = new Date("2001-01-01T12:00:00.000Z");
    limiter.take("email:owner@example.test", t0, { max: 50, windowMs: HOUR });
    const soon = new Date(t0.getTime() + HOUR / 2);
    for (let index = 0; index < 256; index += 1) limiter.take(`ip:192.0.2.${index}`, soon, { max: 20, windowMs: 15 * 60 * 1000 });
    expect(limiter.take("email:owner@example.test", soon, { max: 1, windowMs: HOUR })).toBe(false);
  });
});
