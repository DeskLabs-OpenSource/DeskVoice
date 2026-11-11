import { describe, expect, it } from "vitest";
import { voiceSocketUrl } from "./ws-url";

const at = (href: string) => {
  const url = new URL(href);
  return { protocol: url.protocol, host: url.host };
};

describe("voiceSocketUrl", () => {
  it("uses the same origin and the given path, encrypted when the page is https", () => {
    expect(voiceSocketUrl(at("https://painel.example.test/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("wss://painel.example.test/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://localhost:3000/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("ws://localhost:3000/voice-ws?token=abc");
    expect(voiceSocketUrl(at("https://painel.example.test:8443/x"), { path: "/voice-ws" }, "abc")).toBe("wss://painel.example.test:8443/voice-ws?token=abc");
  });

  it("keeps whatever port the panel was opened on: tunnel, local port or IPv6", () => {
    expect(voiceSocketUrl(at("http://localhost:3080/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("ws://localhost:3080/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://203.0.113.10:3080/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("ws://203.0.113.10:3080/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://[2001:db8::1]:3080/"), { path: "/voice-ws" }, "abc")).toBe("ws://[2001:db8::1]:3080/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://203.0.113.10/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("ws://203.0.113.10/voice-ws?token=abc");
  });

  it("escapes the token", () => {
    expect(voiceSocketUrl(at("https://painel.example.test/"), { path: "/voice-ws" }, "a+b/c=&x")).toBe("wss://painel.example.test/voice-ws?token=a%2Bb%2Fc%3D%26x");
  });
});
