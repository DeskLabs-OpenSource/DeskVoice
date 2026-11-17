import { describe, expect, it } from "vitest";
import { updateNotice, type UpdateStatus } from "./update-notice";

const behind: UpdateStatus = { running: { version: "0.12.1", updatable: true }, published: { ok: true, latest: "0.13.0", newer: [{ version: "0.13.0" }] } };

describe("updateNotice", () => {
  it("highlights the newer version for whoever can update", () => {
    expect(updateNotice(behind, true, true)).toEqual({ version: "0.13.0", newer: true });
    expect(updateNotice(behind, true, false)).toEqual({ version: "0.13.0", newer: true });
  });

  it("shows only the running version, without highlight, to a role that cannot update", () => {
    expect(updateNotice(behind, false, true)).toEqual({ version: "0.12.1", newer: false });
    expect(updateNotice(behind, false, false)).toBeNull();
  });

  it("does not offer an update for a version built on the server, nor when the list is unavailable or up to date", () => {
    expect(updateNotice({ ...behind, running: { version: "0.12.1-dev", updatable: false } }, true, true)).toEqual({ version: "0.12.1-dev", newer: false });
    expect(updateNotice({ ...behind, published: { ok: false } }, true, true)).toEqual({ version: "0.12.1", newer: false });
    expect(updateNotice({ ...behind, published: { ok: true, latest: "0.12.1", newer: [] } }, true, false)).toBeNull();
  });
});
