// O teto do mês é digitado em dólares (vírgula ou ponto, até dois decimais) e vai em centavos. Vazio é
// sem teto. O que não for um valor assim não vai: `Number` daria `NaN`, e o JSON o mandaria como `null`,
// que tira o teto.
const SPEND_CAP_FIELD = /^\d+(?:[.,]\d{1,2})?$/;
export const spendCapField = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2));
export function spendCapValue(field: string): { ok: true; cents: number | null } | { ok: false } {
  const text = field.trim();
  if (text === "") return { ok: true, cents: null };
  if (!SPEND_CAP_FIELD.test(text)) return { ok: false };
  const [whole = "0", fraction = ""] = text.replace(",", ".").split(".");
  return { ok: true, cents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) };
}
