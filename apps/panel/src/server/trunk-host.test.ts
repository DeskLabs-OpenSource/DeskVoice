import { describe, expect, it } from "vitest";
import { isTrunkHost } from "./trunk-host";

describe("isTrunkHost", () => {
  it.each([
    "sip.provedor.com.br",
    "sip.provedor.com.br:5060",
    "203.0.113.20",
    "203.0.113.20:5080",
    "2001:db8::1",
    "[2001:db8::1]",
    "[2001:db8::1]:5060",
    "203.0.113.0/24",
    "203.0.113.20/32",
    "2001:db8::/32",
    "localhost",
  ])("accepts %s", (host) => expect(isTrunkHost(host)).toBe(true));

  it.each([
    "",
    "sip.example.test\n[evil]",
    "sip.example.test\r\ncontact=sip:x",
    "sip.example.test;comment",
    "sip example.test",
    "[evil]",
    "[sip.example.test]",
    "sip.example.test]",
    "[2001:db8::1",
    "[2001:db8::1]extra",
    "2001:db8::1]:5060",
    "203.0.113.0/33",
    "2001:db8::/129",
    "sip.example.test/24",
    "203.0.113.0/24/8",
    "203.0.113.0/",
    "sip.example.test:port",
    "sip.example.test:123456",
    "-sip.example.test",
    "sip.example.test,other.example.test",
    "sip.example.test#x",
    "user@sip.example.test",
    "../etc/asterisk",
    `a${".a".repeat(140)}`,
  ])("refuses %j", (host) => expect(isTrunkHost(host)).toBe(false));
});
