// DDD não tem zero em nenhuma posição. Celular tem 9 dígitos e começa com 9; fixo tem 8 e começa de 2 a 5.
const BR_NATIONAL = /^[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/;
// Números de serviço, sem DDD: 0800 e 0300 (o zero inicial cai na leitura, sobram 800 ou 300 e
// sete dígitos) e os de acesso nacional 4004 e 3003 (oito dígitos ao todo).
const BR_SERVICE = /^(?:[38]00\d{7}|(?:4004|3003)\d{4})$/;

/**
 * Normaliza um telefone digitado livremente para E.164. Sem `+`, o número é lido como do país
 * padrão; com `+`, números de outros países passam se tiverem tamanho plausível.
 */
export function toE164(input: string, defaultCountry: "BR" = "BR"): string | null {
  const text = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");

  if (text.startsWith("+")) {
    if (digits.startsWith("55")) return brazilian(digits.slice(2));
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  // Sem `+` só sabemos ler o país padrão, e hoje ele é um só.
  if (defaultCountry !== "BR") return null;
  // Zero inicial é o prefixo de longa distância ("031..."), não faz parte do número.
  const national = digits.replace(/^0/, "");
  return brazilian(national) ?? (national.startsWith("55") ? brazilian(national.slice(2)) : null);
}

function brazilian(national: string): string | null {
  return BR_NATIONAL.test(national) || BR_SERVICE.test(national) ? `+55${national}` : null;
}

/**
 * O telefone de um id do WhatsApp (`5531999998888:12@s.whatsapp.net`, `5531999998888@c.us`), em E.164.
 * O `@lid` (número oculto) não é telefone. Celular brasileiro antigo chega sem o nono dígito
 * (`553188887777`, medido numa ligação real em 13/11/2026), e ele volta aqui: sem isso o número
 * não passa em `toE164`, nem casa com o mesmo telefone digitado no painel.
 */
export function phoneOfWhatsAppId(id: string | null | undefined): string | null {
  const digits = /^(\d{8,15})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/.exec(id ?? "")?.[1];
  if (!digits) return null;
  const withoutNinth = /^55([1-9][1-9])([6-9]\d{7})$/.exec(digits);
  return withoutNinth ? `+55${withoutNinth[1]}9${withoutNinth[2]}` : `+${digits}`;
}
