import { describe, expect, it } from "vitest";
import { UNKNOWN_IP, clientIp, trustedProxyHops } from "./client-ip";

describe("clientIp", () => {
  it("ignores what the client forged and takes the address our proxy appended", () => {
    expect(clientIp("1.2.3.4, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIp("1.2.3.4,5.6.7.8 ,  2001:db8::1", 1)).toBe("2001:db8::1");
  });

  it("counts from the right by the number of trusted proxies", () => {
    expect(clientIp("1.2.3.4, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
  });

  it("answers unknown instead of trusting the header when it cannot tell", () => {
    expect(clientIp("1.2.3.4, 203.0.113.7", 0)).toBe(UNKNOWN_IP);
    expect(clientIp(null, 1)).toBe(UNKNOWN_IP);
    expect(clientIp("", 1)).toBe(UNKNOWN_IP);
    expect(clientIp("203.0.113.7", 2)).toBe(UNKNOWN_IP);
    expect(clientIp("1.2.3.4, not-an-ip", 1)).toBe(UNKNOWN_IP);
    expect(clientIp("1.2.3.4, ", 1)).toBe(UNKNOWN_IP);
    expect(clientIp("1.2.3.4, 203.0.113.7:443", 1)).toBe(UNKNOWN_IP);
    expect(clientIp("203.0.113.7", -1)).toBe(UNKNOWN_IP);
  });
});

describe("trustedProxyHops", () => {
  it("defaults to one proxy and distrusts a malformed value", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "many" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(0);
  });
});
