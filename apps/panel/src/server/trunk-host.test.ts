import { describe, expect, it } from "vitest";
import { inboundAddressProblem, isTrunkHost } from "./trunk-host";

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

describe("inboundAddressProblem", () => {
  // Os blocos que a Twilio publica para sinalização (https://www.twilio.com/docs/sip-trunking/ip-addresses, 14/11/2026).
  const twilio = ["54.172.60.0/30", "54.244.51.0/30", "54.171.127.192/30", "35.156.191.128/30", "54.65.63.192/30", "54.169.127.128/30", "54.252.254.64/30", "177.71.206.192/30"];

  it.each([...twilio, "203.0.113.20", "203.0.113.20:5080", "198.051.100.099:5080", "198.51.0.0/16", "2001:db8::1", "[2001:db8::1]:5060", "2001:db8::/32", "::ffff:198.51.0.0/112"])(
    "accepts %s",
    (value) => expect(inboundAddressProblem(value)).toBeNull(),
  );

  it.each(["sip.provedor.com.br", "sip.provedor.com.br:5060", "localhost", "1.2.3"])("refuses the name %s", (value) => expect(inboundAddressProblem(value)).toBe("name"));

  it.each(["0.0.0.0/0", "::/0", "10.0.0.0/8", "198.51.0.0/15", "2001:db8::/16", "2001:db8::/31", "::ffff:0:0/96", "::ffff:10.0.0.0/104", "::/64"])(
    "refuses the block %s as too wide",
    (value) => expect(inboundAddressProblem(value)).toBe("too_wide"),
  );
});
