import { describe, expect, it } from "vitest";
import { allowedView, filterOff, trunkFailure } from "./trunk-status";

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

describe("allowedView", () => {
  const neverResolved = { status: "warn", lastError: "The telephony server does not know yet which addresses this line receives calls from; its filter stays off." };
  const notApplied = { status: "unverified", lastError: null };
  const leftOut = { status: "fail", lastError: "This line was left out of the telephony configuration: a line that registers needs user and password." };
  const register = (inboundFilter: boolean, inboundAllowed: string[], state: { status: string; lastError: string | null }) => ({ authMode: "register" as const, inboundFilter, inboundAllowed, ...state });

  it("1: filter on with addresses: accepts only from the list and refuses the others", () => {
    expect(allowedView(register(true, ["203.0.113.7"], neverResolved), true)).toEqual({ label: "allowed", value: "list", others: true, warning: null });
  });

  it("2: filter on, empty list, line in the server with a name that never resolved: no filter yet", () => {
    expect(allowedView(register(true, [], neverResolved), true)).toEqual({ label: "allowed", value: "allowedEmpty", others: false, warning: null });
  });

  it("3: filter on, empty list, line not applied or left out: no address", () => {
    expect(allowedView(register(true, [], notApplied), true)).toEqual({ label: "allowed", value: "allowedNone", others: false, warning: null });
    expect(allowedView(register(true, [], leftOut), true)).toEqual({ label: "allowed", value: "allowedNone", others: false, warning: null });
  });

  it("4: filter off with addresses: the list is what the filter would accept, never what the server accepts now", () => {
    expect(allowedView(register(false, ["203.0.113.7"], neverResolved), true)).toEqual({ label: "allowedIfOn", value: "list", others: false, warning: "filterSwitchedOff" });
  });

  it("5: filter off, empty list, line in the server: any address, and turning the filter on does not close it", () => {
    expect(allowedView(register(false, [], neverResolved), true)).toEqual({ label: "allowed", value: "allowedAny", others: false, warning: "filterSwitchedOffEmpty" });
    expect(allowedView(register(false, [], { status: "fail", lastError: "The provider does not answer." }), true).value).toBe("allowedAny");
  });

  it("6: filter off, empty list, line not applied or left out: no address now, any address once applied", () => {
    expect(allowedView(register(false, [], notApplied), true)).toEqual({ label: "allowed", value: "allowedNone", others: false, warning: "filterSwitchedOffPending" });
    expect(allowedView(register(false, [], leftOut), true)).toEqual({ label: "allowed", value: "allowedNone", others: false, warning: "filterSwitchedOffPending" });
    expect(allowedView(register(false, [], neverResolved), false).value).toBe("allowedNone");
  });

  it("a line by IP filters always, whatever the column says: only states 1 to 3", () => {
    const ip = (inboundAllowed: string[], state: { status: string; lastError: string | null }) => ({ authMode: "ip" as const, inboundFilter: false, inboundAllowed, ...state });
    expect(allowedView(ip(["203.0.113.0/24"], neverResolved), false)).toEqual({ label: "allowed", value: "list", others: true, warning: null });
    expect(allowedView(ip([], neverResolved), true)).toEqual({ label: "allowed", value: "allowedEmpty", others: false, warning: null });
    expect(allowedView(ip([], notApplied), false)).toEqual({ label: "allowed", value: "allowedNone", others: false, warning: null });
  });
});
