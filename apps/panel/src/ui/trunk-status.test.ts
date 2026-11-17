import { describe, expect, it } from "vitest";
import { filterOff, trunkFailure } from "./trunk-status";

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

describe("filterOff", () => {
  const empty = { inboundAllowed: [] as string[] };
  it("a line with a name that never resolved is in the server without a filter, also when the provider does not answer", () => {
    expect(filterOff({ ...empty, status: "warn", lastError: "The telephony server does not know yet which addresses this line receives calls from; its filter stays off." }, true)).toBe(true);
    expect(filterOff({ ...empty, status: "fail", lastError: "The provider does not answer." }, true)).toBe(true);
  });

  it("not before the first apply, not for a line left out, not with addresses, not with a numeric host", () => {
    expect(filterOff({ ...empty, status: "unverified", lastError: null }, true)).toBe(false);
    expect(filterOff({ ...empty, status: "fail", lastError: "This line was left out of the telephony configuration: a line that registers needs user and password." }, true)).toBe(false);
    expect(filterOff({ inboundAllowed: ["203.0.113.7"], status: "warn", lastError: null }, true)).toBe(false);
    expect(filterOff({ ...empty, status: "fail", lastError: "The provider does not answer." }, false)).toBe(false);
  });
});
