/**
 * O conjunto do filtro e a conta do acerto (R12, fatia 1c): a conferência do manifesto barra os
 * conjuntos que mediriam errado mesmo funcionando, e a contagem sai certa contra decisores falsos
 * que erram de propósito, por pergunta.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carregarConjunto, vocabularioDoConjunto } from "./conjunto";
import { avaliar, carregarFiltro, compactar, conferirFiltro, coberturaDasOpcoes, distancia, opcoesDaLeitura, pedidosDoFiltro, semelhanca, tabelaDoFiltro, type ItemDoFiltro, type PedidoDoFiltro, type Registro, type RespostaDaPergunta, type Tipo } from "./filtro";

const vocabulario = vocabularioDoConjunto(carregarConjunto());
const manifesto = JSON.parse(readFileSync(new URL("./conjunto/filtro-pt-br.json", import.meta.url), "utf8")) as { itens: ItemDoFiltro[] };
const itens = carregarFiltro(vocabulario).itens;
const doTipo = (t: Tipo): ItemDoFiltro[] => itens.filter((i) => i.tipo === t);

/** O manifesto com um item trocado (ou acrescentado), para ver a conferência barrar. */
function com(mudar: (itens: ItemDoFiltro[]) => ItemDoFiltro[]): unknown {
  return { ...manifesto, itens: mudar(structuredClone(manifesto.itens)) };
}

describe("o manifesto do filtro", () => {
  it("cada item tem a resposta esperada, e cada termo do vocabulário tem ao menos uma leitura errada", () => {
    expect(itens.length).toBeGreaterThan(0);
    for (const t of vocabulario) expect(doTipo("leitura").some((i) => i.esperado === t), t).toBe(true);
    expect(doTipo("leitura").filter((i) => i.esperado === "nenhum").length).toBeGreaterThanOrEqual(8);
  });

  it("'fundo' e 'terminou' têm as duas respostas, meio a meio: quem responde sempre igual tira 50%", () => {
    const parte = (t: Tipo, r: string): number => doTipo(t).filter((i) => i.esperado === r).length / doTipo(t).length;
    expect(parte("fundo", "pessoa")).toBe(0.5);
    expect(parte("terminou", "terminou")).toBe(0.5);
  });

  it("a leitura errada erra de verdade: duas letras ou mais do termo, sem acento, espaço e pontuação", () => {
    for (const i of doTipo("leitura")) {
      if (i.tipo !== "leitura" || i.esperado === "nenhum") continue;
      expect(distancia(compactar(i.errado ?? ""), compactar(i.esperado)), i.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("o termo esperado está entre as opções de todos os itens da leitura", () => {
    expect(coberturaDasOpcoes(itens, vocabulario)).toEqual({ cobertos: doTipo("leitura").length, total: doTipo("leitura").length, fora: [] });
  });

  it("barra o 'fundo' com uma resposta só (o modelo que nunca marca fundo tiraria 100%)", () => {
    expect(() => conferirFiltro(com((l) => l.map((i) => (i.tipo === "fundo" ? { ...i, esperado: "pessoa" } : i))), vocabulario)).toThrow(/"fundo" precisa/);
    expect(() => conferirFiltro(com((l) => l.map((i) => (i.tipo === "terminou" ? { ...i, esperado: "terminou" } : i))), vocabulario)).toThrow(/"terminou" precisa/);
  });

  it("barra a leitura errada que só troca uma letra, ou só acento e espaço", () => {
    const melgaco = (errado: string) => com((l) => l.map((i) => (i.id === "leitura-02" ? { ...i, trecho: `O sobrenome é ${errado}, pode anotar.`, errado } : i)));
    expect(() => conferirFiltro(melgaco("Melgaco"), vocabulario)).toThrow(/já está escrito|errar de verdade/);
    expect(() => conferirFiltro(melgaco("Mel gaço"), vocabulario)).toThrow(/já está escrito/);
    expect(() => conferirFiltro(melgaco("Melgaso"), vocabulario)).toThrow(/a 1 letra/);
    expect(() => conferirFiltro(melgaco("meu gasto"), vocabulario)).not.toThrow();
  });

  it("barra o termo sem leitura errada, a leitura sem 'nenhuma troca' e o termo escrito certo no trecho", () => {
    expect(() => conferirFiltro(com((l) => l.filter((i) => i.esperado !== "Joinville")), vocabulario)).toThrow(/"Joinville" não tem leitura errada/);
    expect(() => conferirFiltro(com((l) => l.filter((i) => i.esperado !== "nenhum")), vocabulario)).toThrow(/"nenhum"/);
    expect(() => conferirFiltro(com((l) => l.map((i) => (i.id === "leitura-29" ? { ...i, trecho: "Eu queria saber do Rafael." } : i))), vocabulario)).toThrow(/"Rafael" já está escrito/);
  });

  it("barra o 'terminou' com pontuação no fim, que daria a resposta", () => {
    expect(() => conferirFiltro(com((l) => l.map((i) => (i.id === "terminou-13" ? { ...i, trecho: `${i.trecho}...` } : i))), vocabulario)).toThrow(/pontuação/);
  });
});

describe("as opções da leitura", () => {
  it("semelhança igual à ratio() do difflib", () => {
    const pares: [string, string, number][] = [["melgaço", "melgaço,", 0.933333], ["rafael", "aqui", 0.2], ["tupinambá", "tupinambá?", 0.947368], ["deskvoice", "desk", 0.615385], ["abcd", "bcda", 0.75], ["assunção", "assim", 0.461538]];
    for (const [a, b, esperado] of pares) expect(semelhanca(a, b)).toBeCloseTo(esperado, 5);
    expect(semelhanca("", "")).toBe(1);
  });

  it("acha o termo partido em palavras, e as opções saem em ordem alfabética, com 'nenhum' no fim", () => {
    const opcoes = opcoesDaLeitura("O sobrenome é meu gasto, pode anotar.", vocabulario);
    expect(opcoes).toContain("Melgaço");
    expect(opcoes).toHaveLength(5);
    expect(opcoes.at(-1)).toBe("nenhum");
    expect(opcoes.slice(0, -1)).toEqual([...opcoes.slice(0, -1)].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("cada item vira dois pedidos: as três perguntas, e a do item sozinha; o trecho só vai no estado", () => {
    const item = itens.find((i) => i.id === "fundo-13") as ItemDoFiltro;
    const [passada, sozinha] = pedidosDoFiltro([item], vocabulario);
    expect(passada?.estado).toBe(`Agente: ${item.agente}\nPessoa: ${item.trecho}`);
    expect(Object.keys(passada?.perguntas ?? {})).toEqual(["fundo", "terminou", "leitura"]);
    expect(Object.keys(sozinha?.perguntas ?? {})).toEqual(["fundo"]);
    expect(JSON.stringify(passada?.perguntas)).not.toContain(item.trecho);
  });
});

/** Um decisor falso: responde cada pedido pela regra dada, com latência fixa. */
function decidir(regra: (item: ItemDoFiltro, pedido: PedidoDoFiltro) => Partial<Record<Tipo, RespostaDaPergunta>>, lista: readonly ItemDoFiltro[] = itens): Map<number, Registro[]> {
  const registros = pedidosDoFiltro(lista, vocabulario).map((pedido): Registro => ({ pedido, ms: 100, ok: true, respostas: regra(pedido.item, pedido) }));
  return new Map([[1, registros]]);
}
const noul = (v: number): RespostaDaPergunta => ({ type: "noul", noul: v });
const escolha = (c: string, confidence = 0.9): RespostaDaPergunta => ({ type: "choice", choice: c, confidence });
/** A resposta certa da pergunta do item; as outras perguntas recebem 0,5 e "nenhum". */
function certo(item: ItemDoFiltro): Partial<Record<Tipo, RespostaDaPergunta>> {
  const r: Partial<Record<Tipo, RespostaDaPergunta>> = { fundo: noul(0.5), terminou: noul(0.5), leitura: escolha("nenhum") };
  if (item.tipo === "leitura") r.leitura = escolha(item.esperado);
  if (item.tipo === "fundo") r.fundo = noul(item.esperado === "pessoa" ? 0.95 : 0.05);
  if (item.tipo === "terminou") r.terminou = noul(item.esperado === "terminou" ? 0.95 : 0.05);
  return r;
}
const linha = (tabela: string, pergunta: Tipo): string => tabela.split("\n").find((l) => l.startsWith(`| 1 | ${pergunta} |`)) ?? "";
const acerto = (a: number, b: number): string => `${a}/${b} (${Math.round((100 * a) / b)}%)`;

describe("a contagem do acerto, contra decisores falsos que erram de propósito", () => {
  const n = { leitura: doTipo("leitura").length, fundo: doTipo("fundo").length, terminou: doTipo("terminou").length };
  const semTroca = doTipo("leitura").filter((i) => i.esperado === "nenhum").length;

  it("o decisor certo tira 100% nas três", () => {
    const tabela = tabelaDoFiltro(decidir(certo));
    for (const t of ["leitura", "fundo", "terminou"] as const) expect(linha(tabela, t)).toContain(`| ${n[t]} | ${acerto(n[t], n[t])} | ${acerto(n[t], n[t])} | 100 / 100 | 100 / 100 | 0 |`);
  });

  it("errar um de cada três itens em uma pergunta só derruba aquela pergunta, na conta exata", () => {
    for (const t of ["leitura", "fundo", "terminou"] as const) {
      const lista = doTipo(t);
      const erradas = new Set(lista.filter((_, k) => k % 3 === 0).map((i) => i.id));
      const tabela = tabelaDoFiltro(
        decidir((item) => {
          const r = certo(item);
          if (!erradas.has(item.id)) return r;
          if (item.tipo === "leitura") r.leitura = escolha(item.esperado === "nenhum" ? "Rafael" : "nenhum");
          else r[item.tipo] = noul(1 - ((r[item.tipo] as { noul: number }).noul));
          return r;
        }),
      );
      expect(linha(tabela, t), t).toContain(`| ${acerto(n[t] - erradas.size, n[t])} | ${acerto(n[t] - erradas.size, n[t])} |`);
      for (const outra of (["leitura", "fundo", "terminou"] as const).filter((o) => o !== t)) expect(linha(tabela, outra)).toContain(acerto(n[outra], n[outra]));
    }
  });

  it("'nenhuma troca' conta: o decisor que sempre troca perde os itens sem termo", () => {
    // Sempre troca por um termo: o certo quando há, e o primeiro das opções quando não há.
    const tabela = tabelaDoFiltro(decidir((item, pedido) => {
      const r = certo(item);
      const opcoes = Object.keys((pedido.perguntas.leitura as { criteria: Record<string, string> } | undefined)?.criteria ?? {});
      if (item.tipo === "leitura") r.leitura = escolha(item.esperado === "nenhum" ? (opcoes[0] as string) : item.esperado);
      return r;
    }));
    expect(linha(tabela, "leitura")).toContain(`| ${acerto(n.leitura - semTroca, n.leitura)} |`);
    // E cada uma dessas trocas, com 0,9, é troca errada acima do corte.
    expect(tabela).toContain(`leitura que trocaria por um termo errado com confiança ≥ 0.8: ${semTroca} de ${n.leitura} (passada)`);
  });

  it("o decisor que nunca troca só acerta os itens sem termo, e o que escolhe a primeira opção não acerta por posição", () => {
    const nunca = tabelaDoFiltro(decidir((item) => ({ ...certo(item), leitura: escolha("nenhum") })));
    expect(linha(nunca, "leitura")).toContain(`| ${acerto(semTroca, n.leitura)} |`);
    const primeira = tabelaDoFiltro(decidir((item, pedido) => (item.tipo === "leitura" ? { ...certo(item), leitura: escolha(Object.keys((pedido.perguntas.leitura as { criteria: Record<string, string> }).criteria)[0] as string) } : certo(item))));
    const acertosDaPrimeira = doTipo("leitura").filter((i) => opcoesDaLeitura(i.trecho, vocabulario)[0] === i.esperado).length;
    expect(acertosDaPrimeira / n.leitura).toBeLessThan(0.5);
    expect(linha(primeira, "leitura")).toContain(`| ${acerto(acertosDaPrimeira, n.leitura)} |`);
  });

  it("o decisor que nunca marca fundo tira 50%, e o que marca tudo como fundo é contado como 'descartar fala real'", () => {
    const nunca = tabelaDoFiltro(decidir((item) => ({ ...certo(item), fundo: noul(0.99) })));
    expect(linha(nunca, "fundo")).toContain(`| ${acerto(n.fundo / 2, n.fundo)} |`);
    expect(nunca).toContain(`fala de quem liga marcada como fundo com confiança ≥ 0.8: 0 de ${n.fundo / 2} (passada)`);
    const tudo = tabelaDoFiltro(decidir((item) => ({ ...certo(item), fundo: noul(0.1) })));
    expect(linha(tudo, "fundo")).toContain(`| ${acerto(n.fundo / 2, n.fundo)} |`);
    expect(tudo).toContain(`fala de quem liga marcada como fundo com confiança ≥ 0.8: ${n.fundo / 2} de ${n.fundo / 2} (passada), ${n.fundo / 2} de ${n.fundo / 2} (sozinha).`);
    // Com 0,3 (confiança de fundo 0,7), erra, mas fica abaixo do corte.
    const abaixo = tabelaDoFiltro(decidir((item) => ({ ...certo(item), fundo: noul(0.3) })));
    expect(abaixo).toContain(`fala de quem liga marcada como fundo com confiança ≥ 0.8: 0 de ${n.fundo / 2} (passada)`);
  });

  it("resposta sem a pergunta do item, ou pedido que falhou, conta como falha e não como acerto nem erro", () => {
    const lista = doTipo("terminou").slice(0, 2);
    const registros = decidir(certo, lista).get(1) as Registro[];
    registros[0] = { pedido: registros[0]?.pedido as PedidoDoFiltro, ms: 300, ok: false, motivo: "HTTP 500" };
    registros[1] = { pedido: registros[1]?.pedido as PedidoDoFiltro, ms: 100, ok: true, respostas: { fundo: noul(0.5) } };
    const tabela = tabelaDoFiltro(new Map([[1, registros]]));
    expect(linha(tabela, "terminou")).toContain("| 2 | 1/1 (100%) | 1/1 (100%) | 100 / 300 | 100 / 100 | 1× HTTP 500; 1× sem resposta do tipo pedido para terminou |");
  });

  it("avaliar: a leitura com confiança abaixo do corte não é troca errada, e a fronteira do sim é 0,5", () => {
    const leitura = itens.find((i) => i.id === "leitura-29") as ItemDoFiltro;
    expect(avaliar(leitura, escolha("Melgaço", 0.79))).toEqual({ acertou: false, pessoaComoFundo: false, trocaErrada: false });
    expect(avaliar(leitura, escolha("Melgaço", 0.8))).toEqual({ acertou: false, pessoaComoFundo: false, trocaErrada: true });
    expect(avaliar(leitura, { type: "choice", choice: "Melgaço", confidence: null, probabilities: { Melgaço: 0.85 } })?.trocaErrada).toBe(true);
    const terminou = itens.find((i) => i.id === "terminou-01") as ItemDoFiltro;
    expect(avaliar(terminou, noul(0.5))?.acertou).toBe(true);
    expect(avaliar(terminou, noul(0.49))?.acertou).toBe(false);
    expect(avaliar(terminou, escolha("nenhum"))).toBeNull();
  });
});
