import { redirect } from "next/navigation";

/**
 * A tela de IA mora em `/settings/ai` (parte 2 do desenho da central de configuração). Quem chega
 * por um favorito ou link antigo em `/settings` cai nela, com a mesma query. O `#` não chega ao
 * servidor: o navegador o mantém sozinho, porque o redirecionamento não traz um.
 */
export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, item);
  }
  const search = query.toString();
  redirect(search ? `/settings/ai?${search}` : "/settings/ai");
}
