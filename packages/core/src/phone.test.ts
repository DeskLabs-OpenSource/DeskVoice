import { describe, expect, it } from "vitest";
import { phoneOfWhatsAppId, toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["(31) 99999-8888", "+5531999998888"],
    ["031999998888", "+5531999998888"],
    ["+55 31 99999 8888", "+5531999998888"],
    ["5531999998888", "+5531999998888"],
    ["31999998888", "+5531999998888"],
    ["  31 9 9999.8888 ", "+5531999998888"],
    ["(31) 3333-4444", "+553133334444"],
    ["03133334444", "+553133334444"],
    ["553133334444", "+553133334444"],
    ["55999998888", "+5555999998888"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["+351 912 345 678", "+351912345678"],
  ])("normalizes %j to %s", (input, expected) => {
    expect(toE164(input, "BR")).toBe(expected);
  });

  it.each([
    "abc",
    "",
    "   ",
    "99999-8888",
    "31 99999 888",
    "(00) 99999-8888",
    "(30) 99999-8888",
    "(31) 89999-8888",
    "(31) 9333-4444",
    "+55 31 9999",
    "+0 123 456 789",
    "+1 23",
    "+1234567890123456",
    "31 99999-8888 ramal 2",
    "31+999998888",
    "55319999988889",
  ])("rejects %j", (input) => {
    expect(toE164(input, "BR")).toBeNull();
  });

  // Números de serviço não têm DDD. Sem eles não dá para cadastrar um 0800 como linha nem
  // transferir uma ligação para a central de um fornecedor.
  it.each([
    ["0800 123 4567", "+558001234567"],
    ["0800-123-4567", "+558001234567"],
    ["08001234567", "+558001234567"],
    ["+55 800 123 4567", "+558001234567"],
    ["0300 123 4567", "+553001234567"],
    ["4004-1234", "+5540041234"],
    ["4004 1234", "+5540041234"],
    ["3003-9876", "+5530039876"],
    ["+55 4004 1234", "+5540041234"],
  ])("normalizes the service number %j to %s", (input, expected) => {
    expect(toE164(input, "BR")).toBe(expected);
  });

  it.each(["0800 123 456", "0800 123 45678", "0700 123 4567", "4005-1234", "4004-123", "4004-12345", "3003 12"])(
    "rejects the malformed service number %j",
    (input) => {
      expect(toE164(input, "BR")).toBeNull();
    },
  );

  it("defaults to Brazil", () => {
    expect(toE164("(31) 99999-8888")).toBe("+5531999998888");
  });
});

describe("phoneOfWhatsAppId", () => {
  it("lê o telefone do JID e do id do WAHA, com ou sem aparelho", () => {
    expect(phoneOfWhatsAppId("5531999998888:12@s.whatsapp.net")).toBe("+5531999998888");
    expect(phoneOfWhatsAppId("5531999998888@c.us")).toBe("+5531999998888");
    expect(phoneOfWhatsAppId("14155550123@s.whatsapp.net")).toBe("+14155550123");
  });

  it("devolve o nono dígito do celular brasileiro que o WhatsApp manda sem ele", () => {
    expect(phoneOfWhatsAppId("553198887777@s.whatsapp.net")).toBe("+5531998887777");
    expect(phoneOfWhatsAppId("551176543210:3@s.whatsapp.net")).toBe("+5511976543210");
  });

  it("fixo brasileiro fica como está, e o @lid não é telefone", () => {
    expect(phoneOfWhatsAppId("553132221111@s.whatsapp.net")).toBe("+553132221111");
    expect(phoneOfWhatsAppId("123456789012:28@lid")).toBeNull();
    expect(phoneOfWhatsAppId(undefined)).toBeNull();
  });
});

