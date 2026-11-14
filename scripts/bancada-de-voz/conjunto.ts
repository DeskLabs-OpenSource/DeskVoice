/** Leitura e conferência do manifesto do conjunto (`conjunto/<idioma>.json`). Só texto. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CASOS = ["nomes", "empresas", "numeros", "lugares", "geral", "sotaque", "ruido"] as const;
export type Caso = (typeof CASOS)[number];

export interface Frase {
  id: string;
  texto: string;
  casos: Caso[];
  /** Comparados letra por letra (acento, cedilha e maiúscula). */
  termos: string[];
  /** Comparados depois da normalização. */
  numeros: string[];
}

export interface Conjunto {
  versao: number;
  idioma: string;
  frases: Frase[];
}

export function conferirConjunto(dado: unknown): Conjunto {
  const c = dado as Partial<Conjunto> | null;
  if (!c || typeof c.idioma !== "string" || typeof c.versao !== "number" || !Array.isArray(c.frases)) throw new Error("manifesto sem idioma, versão ou frases");
  const ids = new Set<string>();
  for (const f of c.frases) {
    if (typeof f.id !== "string" || typeof f.texto !== "string" || f.texto.trim() === "") throw new Error(`frase sem id ou texto: ${JSON.stringify(f)}`);
    if (ids.has(f.id)) throw new Error(`id repetido: ${f.id}`);
    ids.add(f.id);
    if (!Array.isArray(f.casos) || f.casos.length === 0 || f.casos.some((k) => !(CASOS as readonly string[]).includes(k))) throw new Error(`${f.id}: casos inválidos`);
    if (!Array.isArray(f.termos) || !Array.isArray(f.numeros)) throw new Error(`${f.id}: termos e numeros precisam ser listas`);
    for (const t of f.termos) if (!f.texto.includes(t)) throw new Error(`${f.id}: o termo "${t}" não está escrito na frase`);
  }
  return c as Conjunto;
}

export function carregarConjunto(idioma = "pt-br"): Conjunto {
  return conferirConjunto(JSON.parse(readFileSync(fileURLToPath(new URL(`./conjunto/${idioma}.json`, import.meta.url)), "utf8")));
}

/** O vocabulário da medida "com vocabulário": todos os termos do conjunto, como os cadastraria um agente. */
export function vocabularioDoConjunto(conjunto: Conjunto): string[] {
  return [...new Set(conjunto.frases.flatMap((f) => f.termos))];
}
