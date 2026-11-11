// DDD não tem zero em nenhuma posição. Celular tem 9 dígitos e começa com 9; fixo tem 8 e começa de 2 a 5.
const BR_NATIONAL = /^[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/;

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
  return BR_NATIONAL.test(national) ? `+55${national}` : null;
}
