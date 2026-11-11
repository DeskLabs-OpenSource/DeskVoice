import { describe, expect, it } from "vitest";
import { voiceSocketUrl } from "./ws-url";

const at = (href: string) => {
  const url = new URL(href);
  return { protocol: url.protocol, host: url.host, hostname: url.hostname };
};

describe("voiceSocketUrl", () => {
  it("uses the same origin and the given path, encrypted when the page is https", () => {
    expect(voiceSocketUrl(at("https://painel.example.test/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("wss://painel.example.test/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://localhost:3000/calls/talk"), { path: "/voice-ws" }, "abc")).toBe("ws://localhost:3000/voice-ws?token=abc");
    expect(voiceSocketUrl(at("https://painel.example.test:8443/x"), { path: "/voice-ws" }, "abc")).toBe("wss://painel.example.test:8443/voice-ws?token=abc");
  });

  it("swaps only the port when the voice service is published on its own port", () => {
    expect(voiceSocketUrl(at("http://203.0.113.10:3000/calls/talk"), { port: 8091 }, "abc")).toBe("ws://203.0.113.10:8091/voice-ws?token=abc");
    expect(voiceSocketUrl(at("https://painel.example.test/calls/talk"), { port: 8443 }, "abc")).toBe("wss://painel.example.test:8443/voice-ws?token=abc");
    expect(voiceSocketUrl(at("http://[2001:db8::1]:3000/"), { port: 8091 }, "abc")).toBe("ws://[2001:db8::1]:8091/voice-ws?token=abc");
  });

  it("escapes the token", () => {
    expect(voiceSocketUrl(at("https://painel.example.test/"), { path: "/voice-ws" }, "a+b/c=&x")).toBe("wss://painel.example.test/voice-ws?token=a%2Bb%2Fc%3D%26x");
  });
});
