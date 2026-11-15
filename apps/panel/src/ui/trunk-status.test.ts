import { describe, expect, it } from "vitest";
import { trunkFailure } from "./trunk-status";

describe("trunkFailure", () => {
  const leftOut = "This line was left out of the telephony configuration: a line recognized by IP accepts an address block of at most /16 (IPv4) or /32 (IPv6).";

  it("shows the reason of a line left out of the configuration, and of a line that asks for attention", () => {
    expect(trunkFailure({ status: "fail", lastError: leftOut })).toBe(leftOut);
    expect(trunkFailure({ status: "warn", lastError: "Try again in a minute." })).toBe("Try again in a minute.");
  });

  it("shows nothing for a working line, a line not tested yet, a new line or a failure without a reason", () => {
    expect(trunkFailure({ status: "ok", lastError: leftOut })).toBeNull();
    expect(trunkFailure({ status: "unverified", lastError: leftOut })).toBeNull();
    expect(trunkFailure(null)).toBeNull();
    expect(trunkFailure({ status: "fail", lastError: null })).toBeNull();
    expect(trunkFailure({ status: "fail", lastError: "" })).toBeNull();
  });
});
