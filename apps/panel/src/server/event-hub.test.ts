import { describe, expect, it } from "vitest";
import { createEventHub, type CallEventSignal } from "./event-hub";

function fakeListen() {
  const state = { starts: 0, stops: 0, emit: (_payload: string): void => undefined, fail: (_error: Error): void => undefined };
  const start = async (onPayload: (payload: string) => void, onError: (error: Error) => void) => {
    state.starts += 1;
    state.emit = onPayload;
    state.fail = onError;
    return async () => {
      state.stops += 1;
    };
  };
  return { state, start };
}

const client = (organizationId: string) => {
  const seen: CallEventSignal[] = [];
  const record = { organizationId, seen, closed: 0, onEvent: (event: CallEventSignal) => void seen.push(event), onClose: () => void (record.closed += 1) };
  return record;
};

describe("event hub", () => {
  it("opens one listen for every client and delivers only the client's organization", async () => {
    const { state, start } = fakeListen();
    const hub = createEventHub(start);
    const a1 = client("org-a");
    const a2 = client("org-a");
    const b = client("org-b");
    await Promise.all([hub.subscribe(a1), hub.subscribe(a2), hub.subscribe(b)]);

    state.emit("org-a:call-1:10");
    state.emit("org-b:call-2:11");
    state.emit("malformed");

    expect(state.starts).toBe(1);
    expect(a1.seen).toEqual([{ callId: "call-1", eventId: "10" }]);
    expect(a2.seen).toEqual(a1.seen);
    expect(b.seen).toEqual([{ callId: "call-2", eventId: "11" }]);
  });

  it("stops the listen only when the last client leaves, and reopens for the next one", async () => {
    const { state, start } = fakeListen();
    const hub = createEventHub(start);
    const first = client("org-a");
    const leaveFirst = await hub.subscribe(first);
    const leaveSecond = await hub.subscribe(client("org-a"));

    await leaveFirst();
    await leaveFirst();
    expect(state.stops).toBe(0);
    state.emit("org-a:call-1:1");
    expect(first.seen).toEqual([]);

    await leaveSecond();
    expect(state.stops).toBe(1);
    expect(hub.size()).toBe(0);

    await hub.subscribe(client("org-a"));
    expect(state.starts).toBe(2);
  });

  it("closes every client when the database connection drops, and the next subscription listens again", async () => {
    const { state, start } = fakeListen();
    const hub = createEventHub(start);
    const a = client("org-a");
    const b = client("org-b");
    const leave = await hub.subscribe(a);
    await hub.subscribe(b);

    state.fail(new Error("connection terminated"));
    expect([a.closed, b.closed]).toEqual([1, 1]);
    await leave();
    expect(state.stops).toBe(0);

    await hub.subscribe(client("org-a"));
    expect(state.starts).toBe(2);
  });

  it("does not keep a client whose listen failed to open", async () => {
    let attempts = 0;
    const hub = createEventHub(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("pool exhausted");
      return async () => undefined;
    });
    await expect(hub.subscribe(client("org-a"))).rejects.toThrow(/pool exhausted/);
    expect(hub.size()).toBe(0);
    await hub.subscribe(client("org-a"));
    expect(attempts).toBe(2);
  });
});
