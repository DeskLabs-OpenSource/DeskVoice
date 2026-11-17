/**
 * O conjunto do filtro (R12, fatia 1c) e a conta do acerto, iguais para o Jev e para o Laya.
 *
 * O manifesto (`conjunto/filtro-pt-br.json`) tem itens das três perguntas do desenho, cada um com a
 * resposta esperada: a leitura com a transcrição errada ("meu gasto" no lugar de "Melgaço") ou sem
 * termo nenhum ("nenhum"), a fala de quem liga ou de fundo, e o pensamento completo ou a pausa.
 * Texto inventado, sem áudio: os dois decidem sobre texto.
 *
 * Os pedidos (estado e perguntas) saem daqui, e só daqui: o Jev os manda pela rede, e o
 * `laya_local.py` os executa como chegam. Assim os dois respondem exatamente às mesmas perguntas,
 * sobre o mesmo conjunto.
 *
 * A conferência do manifesto barra os conjuntos que mediriam errado mesmo funcionando (o fracasso
 * da fatia 1c no desenho): "fundo" e "terminou" com uma resposta só (o modelo que nunca marca
 * fundo tiraria 100 %), a leitura errada que é o termo com uma letra trocada ("Melgaco"), o termo
 * do vocabulário sem nenhuma leitura errada, e a leitura sem "nenhuma troca".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "./dependencias";
import { percentil } from "./metricas";

export const TIPOS = ["leitura", "fundo", "terminou"] as const;
export type Tipo = (typeof TIPOS)[number];

/** O corte de confiança do desenho (Parte 3, ponto de partida 0,8), que a fatia 6 vai usar. */
export const CORTE = 0.8;
/** A menor parte de cada resposta em "fundo" e "terminou", e de "nenhum" na leitura. */
const MENOR_PARTE = 0.4;
const MENOR_PARTE_SEM_TROCA = 0.2;

export type ItemDoFiltro =
  | { id: string; tipo: "leitura"; agente: string; trecho: string; errado?: string; esperado: string; nota?: string }
  | { id: string; tipo: "fundo"; agente: string; trecho: string; esperado: "pessoa" | "fundo"; nota?: string }
  | { id: string; tipo: "terminou"; agente: string; trecho: string; esperado: "terminou" | "pausa"; nota?: string };

export interface ConjuntoDoFiltro {
  versao: number;
  idioma: string;
  itens: ItemDoFiltro[];
}

/** Sem acento, sem maiúscula, sem espaço e sem pontuação: "Mel gás só" vira "melgasso". */
export function compactar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function distancia(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) atual[j] = Math.min((anterior[j] ?? 0) + 1, (atual[j - 1] ?? 0) + 1, (anterior[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    anterior = atual;
  }
  return anterior[b.length] ?? 0;
}

/** Confere o manifesto contra o vocabulário do conjunto principal. Lança na primeira coisa errada. */
export function conferirFiltro(dado: unknown, vocabulario: readonly string[]): ConjuntoDoFiltro {
  const c = dado as Partial<ConjuntoDoFiltro> | null;
  if (!c || typeof c.idioma !== "string" || typeof c.versao !== "number" || !Array.isArray(c.itens)) throw new Error("manifesto do filtro sem idioma, versão ou itens");
  const ids = new Set<string>();
  const termosCompactos = vocabulario.map((t) => [t, compactar(t)] as const);
  const respostas: Record<Tipo, string[]> = { leitura: [], fundo: [], terminou: [] };
  for (const item of c.itens) {
    const i = item as Partial<ItemDoFiltro> & { errado?: unknown };
    if (typeof i.id !== "string" || typeof i.agente !== "string" || typeof i.trecho !== "string" || i.agente.trim() === "" || i.trecho.trim() === "") throw new Error(`item sem id, agente ou trecho: ${JSON.stringify(item)}`);
    if (ids.has(i.id)) throw new Error(`id repetido: ${i.id}`);
    ids.add(i.id);
    if (!(TIPOS as readonly unknown[]).includes(i.tipo)) throw new Error(`${i.id}: tipo inválido`);
    const tipo = i.tipo as Tipo;
    if (typeof i.esperado !== "string") throw new Error(`${i.id}: sem resposta esperada`);
    respostas[tipo].push(i.esperado);
    const trecho = compactar(i.trecho);
    if (tipo === "leitura") {
      // Nenhum termo do vocabulário escrito certo no trecho: a única leitura certa é a esperada.
      for (const [t, tc] of termosCompactos) if (trecho.includes(tc)) throw new Error(`${i.id}: o termo "${t}" já está escrito no trecho`);
      if (i.esperado === "nenhum") {
        if (i.errado !== undefined) throw new Error(`${i.id}: "nenhum" não tem trecho errado`);
        continue;
      }
      if (!vocabulario.includes(i.esperado)) throw new Error(`${i.id}: "${i.esperado}" não é termo do vocabulário`);
      if (typeof i.errado !== "string" || !i.trecho.includes(i.errado)) throw new Error(`${i.id}: o pedaço errado não está escrito no trecho`);
      // A troca de uma letra (ou só de acento e espaço) não é o erro que acontece.
      const d = distancia(compactar(i.errado), compactar(i.esperado));
      if (d < 2) throw new Error(`${i.id}: "${i.errado}" está a ${d} letra de "${i.esperado}"; a leitura errada precisa errar de verdade`);
    } else if (tipo === "fundo") {
      if (i.esperado !== "pessoa" && i.esperado !== "fundo") throw new Error(`${i.id}: "fundo" espera "pessoa" ou "fundo"`);
    } else {
      if (i.esperado !== "terminou" && i.esperado !== "pausa") throw new Error(`${i.id}: "terminou" espera "terminou" ou "pausa"`);
      if (/[.?!…,;:]\s*$/.test(i.trecho)) throw new Error(`${i.id}: o trecho de "terminou" não tem pontuação no fim`);
    }
  }
  for (const t of vocabulario) if (!respostas.leitura.includes(t)) throw new Error(`o termo "${t}" não tem leitura errada no conjunto`);
  const parte = (tipo: Tipo, resposta: string): number => respostas[tipo].filter((r) => r === resposta).length / Math.max(1, respostas[tipo].length);
  if (parte("leitura", "nenhum") < MENOR_PARTE_SEM_TROCA) throw new Error(`a leitura precisa de ao menos ${MENOR_PARTE_SEM_TROCA * 100}% de "nenhum"`);
  for (const [tipo, a, b] of [["fundo", "pessoa", "fundo"], ["terminou", "terminou", "pausa"]] as const) {
    if (parte(tipo, a) < MENOR_PARTE || parte(tipo, b) < MENOR_PARTE) throw new Error(`"${tipo}" precisa de ao menos ${MENOR_PARTE * 100}% de "${a}" e de "${b}"`);
  }
  return c as ConjuntoDoFiltro;
}

export function carregarFiltro(vocabulario: readonly string[], idioma = "pt-br"): ConjuntoDoFiltro {
  return conferirFiltro(JSON.parse(readFileSync(fileURLToPath(new URL(`./conjunto/filtro-${idioma}.json`, import.meta.url)), "utf8")), vocabulario);
}

/** Quantos caracteres as duas palavras têm em comum, pelos blocos de Ratcliff/Obershelp (os do `difflib`). */
function emComum(a: string, b: string): number {
  if (!a || !b) return 0;
  let tamanho = 0;
  let ia = 0;
  let ib = 0;
  let anterior = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const atual = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      atual[j] = (anterior[j - 1] ?? 0) + 1;
      if ((atual[j] ?? 0) > tamanho) {
        tamanho = atual[j] ?? 0;
        ia = i - tamanho;
        ib = j - tamanho;
      }
    }
    anterior = atual;
  }
  if (tamanho === 0) return 0;
  return tamanho + emComum(a.slice(0, ia), b.slice(0, ib)) + emComum(a.slice(ia + tamanho), b.slice(ib + tamanho));
}

/** A `ratio()` do `SequenceMatcher` do Python. */
export function semelhanca(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 1 : (2 * emComum(a, b)) / total;
}

/** Até quantas palavras seguidas do trecho um termo pode ter virado ("meu gasto", "ita quá quá setuba"). */
const MAIOR_JANELA = 4;
const OPCOES = 4;

/**
 * Os termos do vocabulário que mais se parecem com algum pedaço do trecho (até 4), mais "nenhum".
 * O pedaço é de 1 a 4 palavras seguidas, comparado sem acento, espaço e pontuação: a transcrição
 * errada costuma partir o termo em palavras ("meu gasto").
 */
export function opcoesDaLeitura(trecho: string, vocabulario: readonly string[]): string[] {
  const palavras = trecho.split(/\s+/).map(compactar).filter(Boolean);
  const pedacos: string[] = [];
  for (let n = 1; n <= MAIOR_JANELA; n++) for (let i = 0; i + n <= palavras.length; i++) pedacos.push(palavras.slice(i, i + n).join(""));
  const nota = new Map(vocabulario.map((t) => [t, Math.max(0, ...pedacos.map((p) => semelhanca(compactar(t), p)))]));
  const parecidos = [...vocabulario].sort((x, y) => (nota.get(y) ?? 0) - (nota.get(x) ?? 0)).slice(0, OPCOES);
  // Em ordem alfabética: na ordem da semelhança, o termo certo viria quase sempre primeiro, e o
  // modelo que escolhe a primeira opção acertaria sem ler.
  return [...parecidos.sort((x, y) => x.localeCompare(y, "pt-BR")), "nenhum"];
}

export type Pergunta = { type: "noul"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> };

/** As três perguntas do desenho (Parte 3), fixas. O que a pessoa disse vai no estado, nunca aqui. */
export function perguntasDoFiltro(trecho: string, vocabulario: readonly string[]): Record<Tipo, Pergunta> {
  const criteria: Record<string, string> = {};
  for (const t of opcoesDaLeitura(trecho, vocabulario)) criteria[t] = t === "nenhum" ? "nenhum destes termos foi dito; o texto está certo como está" : `a pessoa disse ${t}`;
  return {
    fundo: { type: "noul", instructions: "A última fala é de quem está na ligação, conversando com o agente (e não fala de fundo, como TV, rádio, anúncio ou outra pessoa na sala)?" },
    terminou: { type: "noul", instructions: "A pessoa terminou o pensamento (e não só fez uma pausa no meio)?" },
    leitura: { type: "choice", instructions: "O texto da pessoa veio de uma transcrição, que pode ter escrito errado um nome. Qual destes termos a pessoa disse?", criteria },
  };
}

export function estadoDoItem(item: Pick<ItemDoFiltro, "agente" | "trecho">): string {
  return `Agente: ${item.agente}\nPessoa: ${item.trecho}`;
}

/** Um pedido ao modelo: o estado e as perguntas, como vão para o Jev e para o `laya_local.py`. */
export interface PedidoDoFiltro {
  item: ItemDoFiltro;
  /** "passada": as três perguntas num pedido; "sozinha": só a pergunta do item. */
  modo: "passada" | "sozinha";
  estado: string;
  perguntas: Partial<Record<Tipo, Pergunta>>;
}

export function pedidosDoFiltro(itens: readonly ItemDoFiltro[], vocabulario: readonly string[]): PedidoDoFiltro[] {
  return itens.flatMap((item) => {
    const q = perguntasDoFiltro(item.trecho, vocabulario);
    const estado = estadoDoItem(item);
    return [
      { item, modo: "passada" as const, estado, perguntas: q },
      { item, modo: "sozinha" as const, estado, perguntas: { [item.tipo]: q[item.tipo] } },
    ];
  });
}

/** A resposta de uma pergunta, no formato do Jev (e do Laya, que manda campos a mais). */
export const RespostaDaPergunta = z.union([
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().nullable().optional(), probabilities: z.record(z.string(), z.number()).optional() }),
]);
export type RespostaDaPergunta = z.infer<typeof RespostaDaPergunta>;

/** O que cada pedido deu. A latência conta mesmo quando a resposta falha. */
export type Registro = { pedido: PedidoDoFiltro; ms: number } & ({ ok: true; respostas: Record<string, RespostaDaPergunta> } | { ok: false; motivo: string });

export interface Avaliacao {
  acertou: boolean;
  /** Fala de quem liga marcada como fundo com confiança no corte ou acima: o fracasso "descartar fala real". */
  pessoaComoFundo: boolean;
  /** A leitura trocaria o texto por um termo errado (confiança no corte ou acima). */
  trocaErrada: boolean;
}

/** A confiança da escolha: `confidence`, ou a probabilidade da opção escolhida, ou zero. */
function confiancaDaEscolha(r: Extract<RespostaDaPergunta, { type: "choice" }>): number {
  return r.confidence ?? r.probabilities?.[r.choice] ?? 0;
}

/** Avalia a resposta da pergunta do item. Sem resposta do tipo pedido, nulo (é falha). */
export function avaliar(item: ItemDoFiltro, resposta: RespostaDaPergunta | undefined): Avaliacao | null {
  if (item.tipo === "leitura") {
    if (resposta?.type !== "choice") return null;
    const acertou = resposta.choice === item.esperado;
    return { acertou, pessoaComoFundo: false, trocaErrada: !acertou && resposta.choice !== "nenhum" && confiancaDaEscolha(resposta) >= CORTE };
  }
  if (resposta?.type !== "noul") return null;
  if (item.tipo === "fundo") {
    // A pergunta é "é de quem está na ligação?": 1 é pessoa, 0 é fundo.
    const previsto = resposta.noul >= 0.5 ? "pessoa" : "fundo";
    return { acertou: previsto === item.esperado, pessoaComoFundo: item.esperado === "pessoa" && 1 - resposta.noul >= CORTE, trocaErrada: false };
  }
  const previsto = resposta.noul >= 0.5 ? "terminou" : "pausa";
  return { acertou: previsto === item.esperado, pessoaComoFundo: false, trocaErrada: false };
}

const ms = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));
const fracao = (a: number, b: number): string => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);

interface Conta {
  avaliados: number;
  acertos: number;
  pessoaComoFundo: number;
  pessoas: number;
  trocasErradas: number;
  falhas: Map<string, number>;
  latencias: number[];
}

function contar(registros: readonly Registro[]): Conta {
  const c: Conta = { avaliados: 0, acertos: 0, pessoaComoFundo: 0, pessoas: 0, trocasErradas: 0, falhas: new Map(), latencias: [] };
  const falhou = (motivo: string): void => void c.falhas.set(motivo, (c.falhas.get(motivo) ?? 0) + 1);
  for (const r of registros) {
    c.latencias.push(r.ms);
    if (!r.ok) {
      falhou(r.motivo);
      continue;
    }
    const a = avaliar(r.pedido.item, r.respostas[r.pedido.item.tipo]);
    if (!a) {
      falhou(`sem resposta do tipo pedido para ${r.pedido.item.tipo}`);
      continue;
    }
    c.avaliados++;
    if (a.acertou) c.acertos++;
    if (r.pedido.item.tipo === "fundo" && r.pedido.item.esperado === "pessoa") c.pessoas++;
    if (a.pessoaComoFundo) c.pessoaComoFundo++;
    if (a.trocaErrada) c.trocasErradas++;
  }
  return c;
}

/**
 * A tabela de um modelo: por número de chamadas simultâneas e por pergunta, o acerto na passada
 * (as três perguntas num pedido) e com a pergunta sozinha, a latência das duas, e as falhas. Abaixo,
 * as falas de quem liga marcadas como fundo acima do corte, e as trocas erradas da leitura.
 */
export function tabelaDoFiltro(porConcorrencia: ReadonlyMap<number, readonly Registro[]>, semChave: (texto: string) => string = (t) => t): string {
  const linhas = [
    "| Chamadas simultâneas | Pergunta | Itens | Acerto (passada de 3) | Acerto (sozinha) | Passada p50/p95 (ms) | Sozinha p50/p95 (ms) | Falhas |",
    "|---:|---|---:|---:|---:|---:|---:|---|",
  ];
  const fracassos: string[] = [];
  for (const [n, registros] of porConcorrencia) {
    for (const tipo of TIPOS) {
      const doTipo = registros.filter((r) => r.pedido.item.tipo === tipo);
      if (doTipo.length === 0) continue;
      const passada = contar(doTipo.filter((r) => r.pedido.modo === "passada"));
      const sozinha = contar(doTipo.filter((r) => r.pedido.modo === "sozinha"));
      const falhas = new Map<string, number>();
      for (const c of [passada, sozinha]) for (const [m, v] of c.falhas) falhas.set(m, (falhas.get(m) ?? 0) + v);
      const itens = new Set(doTipo.map((r) => r.pedido.item.id)).size;
      const falhasTexto = [...falhas].map(([m, v]) => `${v}× ${semChave(m)}`).join("; ") || "0";
      linhas.push(
        `| ${n} | ${tipo} | ${itens} | ${fracao(passada.acertos, passada.avaliados)} | ${fracao(sozinha.acertos, sozinha.avaliados)} | ${ms(percentil(passada.latencias, 50))} / ${ms(percentil(passada.latencias, 95))} | ${ms(percentil(sozinha.latencias, 50))} / ${ms(percentil(sozinha.latencias, 95))} | ${falhasTexto} |`,
      );
      if (tipo === "fundo") fracassos.push(`- ${n} chamada(s), fala de quem liga marcada como fundo com confiança ≥ ${CORTE}: ${passada.pessoaComoFundo} de ${passada.pessoas} (passada), ${sozinha.pessoaComoFundo} de ${sozinha.pessoas} (sozinha).`);
      if (tipo === "leitura") fracassos.push(`- ${n} chamada(s), leitura que trocaria por um termo errado com confiança ≥ ${CORTE}: ${passada.trocasErradas} de ${passada.avaliados} (passada), ${sozinha.trocasErradas} de ${sozinha.avaliados} (sozinha).`);
    }
  }
  return [...linhas, "", ...fracassos].join("\n");
}

/** Em quantos itens da leitura o termo esperado está entre as opções (sem isso, nenhum modelo acerta). */
export function coberturaDasOpcoes(itens: readonly ItemDoFiltro[], vocabulario: readonly string[]): { cobertos: number; total: number; fora: string[] } {
  const leituras = itens.filter((i) => i.tipo === "leitura");
  const fora = leituras.filter((i) => !opcoesDaLeitura(i.trecho, vocabulario).includes(i.esperado)).map((i) => i.id);
  return { cobertos: leituras.length - fora.length, total: leituras.length, fora };
}
