import { describe, expect, it } from "vitest";
import type { VoiceEngine, VoiceSession, VoiceSessionConfig, VoiceSessionEvents } from "../../packages/voice-engine/src/types";
import { AFTER_CLOSE_MS, AFTER_WORDS_MS, ASK_TO_REPEAT, WITHOUT_WORDS_MS } from "../../apps/voice/src/silence-guard";
import {
  FALA_DO_AGENTE,
  JANELA_S,
  bancadaContraOProvedor,
  escutar,
  itensDoMotor,
  medirFraseLonga,
  medirInterrupcao,
  medirResposta,
  piorCasoDoItem,
  tabelaDaInterrupcao,
  tabelaDaResposta,
  type AudioDaFrase,
  type Linha,
  type AudioPorBaixo,
  type Plano,
  type RelogioComAgenda,
} from "./barulho-no-provedor";
import type { MotorDeHoje } from "./servicos/_motor-de-hoje";

const BYTES_POR_MS = 16;

/** Relógio falso com agenda: `esperarAte` dispara, na ordem, os prazos que vencem até o instante pedido. */
function relogioFalso(): RelogioComAgenda {
  let agora = 0;
  const prazos: { em: number; fn: () => void; vivo: boolean }[] = [];
  return {
    agora: () => agora,
    agendar: (fn, atrasoMs) => {
      const prazo = { em: agora + atrasoMs, fn, vivo: true };
      prazos.push(prazo);
      return () => {
        prazo.vivo = false;
      };
    },
    esperarAte: async (instante) => {
      for (;;) {
        const proximo = prazos.filter((p) => p.vivo && p.em <= instante).sort((a, b) => a.em - b.em)[0];
        if (!proximo) break;
        proximo.vivo = false;
        agora = Math.max(agora, proximo.em);
        proximo.fn();
      }
      agora = Math.max(agora, instante);
    },
  };
}

/** Sessão falsa: guarda o que a bancada mandou e deixa o teste emitir os eventos do motor. */
class SessaoFalsa implements VoiceSession {
  readonly handlers = new Map<string, ((...args: never[]) => void)[]>();
  bytesRecebidos = 0;
  readonly falas: string[] = [];
  fechamentos = 0;
  fechada = false;
  aoReceber: (bytesAteAqui: number) => void = () => undefined;
  aoFalar: (texto: string) => void = () => undefined;
  aoFecharOTurno: () => void = () => undefined;

  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler as (...args: never[]) => void]);
  }
  emitir<K extends keyof VoiceSessionEvents>(event: K, ...args: Parameters<VoiceSessionEvents[K]>): void {
    for (const h of this.handlers.get(event) ?? []) (h as (...a: Parameters<VoiceSessionEvents[K]>) => void)(...args);
  }
  sendAudio(pcm: Buffer): void {
    this.bytesRecebidos += pcm.length;
    this.aoReceber(this.bytesRecebidos);
  }
  sendToolResult(): void {}
  say(texto: string): void {
    this.falas.push(texto);
    this.aoFalar(texto);
  }
  closeCallerTurn(): void {
    this.fechamentos++;
    this.aoFecharOTurno();
  }
  async close(): Promise<void> {
    this.fechada = true;
  }
}

/** Preço falso: 1 centavo por segundo de `usage`, para o custo real ser fácil de conferir. */
const motorFalso = { pricing: { centsPerMinute: 60, checkedOn: "2026-11-15", source: "teste" } } as unknown as VoiceEngine;

const audioDoAgente = (ms: number): Buffer => Buffer.alloc(ms * BYTES_POR_MS);

function frase(falaInicioMs: number, falaFimMs: number, totalMs: number): AudioDaFrase {
  return { id: "f1", pcm8k: Buffer.alloc(totalMs * BYTES_POR_MS), falaInicioMs, falaFimMs, ruido: { tipo: "obra", snrDb: 5, snrMedidoDb: 5 } };
}

describe("medirResposta", () => {
  it("mede do fim da fala ao primeiro áudio do agente, no ritmo da ligação, e para de mandar quando ele responde", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    // A fala acaba aos 3 s do áudio; o agente responde 700 ms depois, e o `usage` chega no fim da resposta.
    relogio.agendar(() => sessao.emitir("audio", audioDoAgente(1000)), 3700);
    relogio.agendar(() => sessao.emitir("usage", { seconds: 2 }), 4800);
    const r = await medirResposta(sessao, escuta, relogio, frase(1000, 3000, 24000));

    expect(r).toEqual({ respostaMs: 700, semResposta: false, antecipou: false, guardaFechou: false, guardaPediuRepetir: false, foraDoRitmo: false });
    // Não manda o arquivo inteiro de uma vez: saiu só o que já "foi falado" até a resposta.
    expect(sessao.bytesRecebidos).toBe(3700 * BYTES_POR_MS);
    // O custo é o do `usage`, depois da resposta.
    expect(escuta.custoUsd).toBeCloseTo(0.02);
  });

  it("o agente que fala antes do fim da frase antecipou: não entra no tempo de resposta", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    relogio.agendar(() => sessao.emitir("audio", audioDoAgente(500)), 2000);
    const r = await medirResposta(sessao, escuta, relogio, frase(1000, 3000, 24000));
    expect(r.antecipou).toBe(true);
    expect(r.respostaMs).toBeNull();
  });

  it("com a guarda: quem ligou falou e o provedor não fechou o turno, a guarda fecha no prazo e o agente responde", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    for (let t = 1000; t <= 3000; t += 500) relogio.agendar(() => sessao.emitir("callerActivity", { words: true }), t);
    // O provedor só responde quando a bancada pede (`closeCallerTurn`), 300 ms depois.
    sessao.aoFecharOTurno = () => relogio.agendar(() => sessao.emitir("audio", audioDoAgente(800)), 300);
    const r = await medirResposta(sessao, escuta, relogio, frase(1000, 3000, 24000));

    expect(sessao.fechamentos).toBe(1);
    expect(escuta.acoes).toEqual([{ acao: "turn_closed", emMs: 3000 + AFTER_WORDS_MS }]);
    expect(r).toMatchObject({ respostaMs: AFTER_WORDS_MS + 300, guardaFechou: true, guardaPediuRepetir: false, semResposta: false });
  });

  it("com a guarda e o agente calado: fecha o turno, pede para repetir, e o pedido é o primeiro áudio", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    relogio.agendar(() => sessao.emitir("callerActivity", { words: true }), 3000);
    sessao.aoFalar = () => relogio.agendar(() => sessao.emitir("audio", audioDoAgente(2000)), 200);
    const r = await medirResposta(sessao, escuta, relogio, frase(1000, 3000, 24000));

    expect(sessao.falas).toEqual([ASK_TO_REPEAT["pt-BR"]]);
    expect(r).toMatchObject({ respostaMs: AFTER_WORDS_MS + AFTER_CLOSE_MS + 200, guardaFechou: true, guardaPediuRepetir: true });
  });

  it("sem a guarda, o mesmo caso fica sem resposta até o fim da cauda", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    for (let t = 1000; t <= 3000; t += 500) relogio.agendar(() => sessao.emitir("callerActivity", { words: true }), t);
    const r = await medirResposta(sessao, escuta, relogio, frase(1000, 3000, 24000));

    expect(sessao.fechamentos).toBe(0);
    expect(r).toMatchObject({ respostaMs: null, semResposta: true, guardaFechou: false });
    expect(sessao.bytesRecebidos).toBe(24000 * BYTES_POR_MS);
  });

  it("o envio que saiu do ritmo não entra no tempo de resposta", async () => {
    const relogio = relogioFalso();
    const travado: RelogioComAgenda = {
      ...relogio,
      // A máquina trava 500 ms antes do décimo pedaço.
      esperarAte: (instante) => relogio.esperarAte(instante === 200 ? 700 : instante),
    };
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, travado, false);
    relogio.agendar(() => sessao.emitir("audio", audioDoAgente(500)), 3700);
    const r = await medirResposta(sessao, escuta, travado, frase(1000, 3000, 24000));
    expect(r.foraDoRitmo).toBe(true);
    expect(r.respostaMs).toBeNull();
  });
});

describe("escutar com a guarda", () => {
  it("o `interrupted` do motor solta a guarda: a fala de quem ligou depois dele volta a armar o prazo", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    // O agente manda 10 s de fala, e o motor a interrompe 1 s depois: o agente parou de falar.
    sessao.emitir("audio", audioDoAgente(10000));
    relogio.agendar(() => sessao.emitir("interrupted"), 1000);
    relogio.agendar(() => sessao.emitir("callerActivity", { words: true }), 1500);
    await relogio.esperarAte(1500 + AFTER_WORDS_MS);
    expect(escuta.acoes).toEqual([{ acao: "turn_closed", emMs: 1500 + AFTER_WORDS_MS }]);
    expect(sessao.fechamentos).toBe(1);
  });

  it("pararGuarda desarma o prazo que estava correndo: a sessão fechada não fecha turno nem fala", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    sessao.emitir("callerActivity", { words: true });
    await relogio.esperarAte(100);
    escuta.pararGuarda();
    await relogio.esperarAte(60000);
    expect(escuta.acoes).toEqual([]);
    expect(sessao.fechamentos).toBe(0);
    expect(sessao.falas).toEqual([]);
  });
});

describe("piorCasoDoItem", () => {
  // A 0,6 US$/min, escrito à mão: (segundos de áudio + 8 s de espera) / 60 × 0,6.
  const motor = { piorCasoUsdPorMinuto: 0.6 };

  it("resposta e frase longa: o áudio inteiro do item mais 8 s de espera", () => {
    // 1 s de áudio + 8 s = 9 s = US$ 0,09.
    expect(piorCasoDoItem(motor, "resposta", Buffer.alloc(1000 * BYTES_POR_MS))).toBeCloseTo(0.09, 10);
    // 13 s de áudio + 8 s = 21 s = US$ 0,21.
    expect(piorCasoDoItem(motor, "longa", Buffer.alloc(13000 * BYTES_POR_MS))).toBeCloseTo(0.21, 10);
  });

  it("interrupção: 10 s de silêncio até o agente falar, 12 s de janela e 8 s de espera", () => {
    // 10 + 12 + 8 = 30 s = US$ 0,30, seja qual for o áudio por baixo.
    expect(piorCasoDoItem(motor, "interrupcao")).toBeCloseTo(0.3, 10);
  });
});

describe("itensDoMotor", () => {
  it("a frase longa roda só com a guarda, uma vez por ambiente; resposta e interrupção, com e sem", () => {
    const itens = itensDoMotor(
      { nFrases: 1, frases: [frase(200, 800, 1000)], porBaixo: [{ caso: "uhum", snrDb: null, pcm8k: Buffer.alloc(0) }], longas: [frase(200, 12200, 13000)] },
      ["resposta", "interrupcao", "longa"],
    );
    const resumo = itens.map((i) => `${i.ambiente} ${i.comGuarda ? "com" : "sem"} ${i.parte}`);
    expect(resumo).toEqual([
      "normal sem resposta",
      "normal sem interrupcao",
      "normal com resposta",
      "normal com interrupcao",
      "normal com longa",
      "noisy sem resposta",
      "noisy sem interrupcao",
      "noisy com resposta",
      "noisy com interrupcao",
      "noisy com longa",
    ]);
  });
});

describe("as tabelas", () => {
  const ruido = { tipo: "obra", snrDb: 5, snrMedidoDb: 5 } as const;
  const resposta = (r: Partial<Extract<Linha, { parte: "resposta" }>["r"]>, comGuarda = true): Linha => ({
    parte: "resposta",
    ambiente: "noisy",
    comGuarda,
    frase: { ...frase(1000, 3000, 24000), ruido },
    r: { respostaMs: null, semResposta: false, antecipou: false, guardaFechou: false, guardaPediuRepetir: false, foraDoRitmo: false, ...r },
  });

  it("resposta: mediana e p90 só das frases em que a guarda não pediu para repetir, com o total e o n da conta", () => {
    const linhas = [
      resposta({ respostaMs: 300 }),
      resposta({ respostaMs: 100 }),
      resposta({ respostaMs: 900 }),
      // A guarda fechou o turno e o motor respondeu: entra.
      resposta({ respostaMs: 2800, guardaFechou: true }),
      // O primeiro áudio foi o "pode repetir" da guarda: fica fora da mediana.
      resposta({ respostaMs: 9000, guardaFechou: true, guardaPediuRepetir: true }),
      resposta({ semResposta: true }),
    ];
    const tabela = tabelaDaResposta(linhas);
    expect(tabela).toContain("| Ambiente | Guarda | Ruído | dB | Frases | Na mediana | Mediana | p90 | Sem resposta | Antecipou | Guarda fechou o turno | Guarda pediu para repetir | Fora do ritmo |");
    // 6 frases, 4 na conta: [100, 300, 900, 2800] → mediana 300, p90 2800.
    expect(tabela).toContain("| noisy | com | obra | 5 | 6 | 4 | 300 | 2800 | 1 | 0 | 2 | 1 | 0 |");
  });

  it("resposta: um grupo por ambiente, guarda, ruído e nível", () => {
    const tabela = tabelaDaResposta([resposta({ respostaMs: 500 }, false), resposta({ respostaMs: 700 }, true)]);
    expect(tabela).toContain("| noisy | sem | obra | 5 | 1 | 1 | 500 | 500 | 0 | 0 | 0 | 0 | 0 |");
    expect(tabela).toContain("| noisy | com | obra | 5 | 1 | 1 | 700 | 700 | 0 | 0 | 0 | 0 | 0 |");
  });

  it("interrupção: o número de `interrupted` de cada caso, e traço quando o agente não falou", () => {
    const porBaixo: AudioPorBaixo = { caso: "musica", snrDb: 5, pcm8k: Buffer.alloc(0) };
    const base = { agenteNaoFalou: false, interrupcoes: 3, falaDoAgenteMs: 4500, guardaAgiu: false, foraDoRitmo: false };
    const tabela = tabelaDaInterrupcao([
      { parte: "interrupcao", ambiente: "normal", comGuarda: false, porBaixo, r: base },
      { parte: "interrupcao", ambiente: "noisy", comGuarda: true, porBaixo: { ...porBaixo, caso: "uhum", snrDb: null }, r: { ...base, agenteNaoFalou: true, interrupcoes: 0, falaDoAgenteMs: 0 } },
    ]);
    expect(tabela).toContain("| normal | sem | musica | 5 | 3 | 4.5 | não | não | não |");
    expect(tabela).toContain("| noisy | com | uhum | nível da voz | — | 0.0 | sim | não | não |");
  });
});

describe("medirInterrupcao", () => {
  const porBaixo: AudioPorBaixo = { caso: "musica", snrDb: 5, pcm8k: Buffer.alloc(JANELA_S * 1000 * BYTES_POR_MS) };

  it("conta o `interrupted` do motor que chega enquanto o áudio do agente tocaria, e não o que chega com ele calado", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    sessao.aoFalar = () => {
      // O agente gera 10 s de fala de uma vez, aos 500 ms.
      relogio.agendar(() => sessao.emitir("audio", audioDoAgente(10000)), 500);
      // O ruído interrompe aos 2 s (conta); a ponte descarta o resto.
      relogio.agendar(() => sessao.emitir("interrupted"), 2000);
      // O agente volta a falar (3 s) e é interrompido de novo aos 4 s (conta).
      relogio.agendar(() => sessao.emitir("audio", audioDoAgente(3000)), 3000);
      relogio.agendar(() => sessao.emitir("interrupted"), 4000);
      // Aos 8 s o agente já está calado: o OpenAI manda `interrupted` a cada início de fala, e este não conta.
      relogio.agendar(() => sessao.emitir("interrupted"), 8000);
    };
    const r = await medirInterrupcao(sessao, escuta, relogio, porBaixo);

    expect(sessao.falas).toEqual([FALA_DO_AGENTE]);
    expect(r.interrupcoes).toBe(2);
    expect(escuta.interrupcoesForaDaFala).toBe(1);
    expect(r.agenteNaoFalou).toBe(false);
    // Da primeira fala (500 ms) até a última interrupção (4 s).
    expect(r.falaDoAgenteMs).toBe(3500);
  });

  it("o áudio que acaba sozinho não é interrupção", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    sessao.aoFalar = () => relogio.agendar(() => sessao.emitir("audio", audioDoAgente(3000)), 500);
    const r = await medirInterrupcao(sessao, escuta, relogio, porBaixo);
    expect(r.interrupcoes).toBe(0);
    expect(r.falaDoAgenteMs).toBe(3000);
  });

  it("o ruído vai por baixo durante a janela inteira, no ritmo, depois de o agente começar", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    sessao.aoFalar = () => relogio.agendar(() => sessao.emitir("audio", audioDoAgente(3000)), 500);
    await medirInterrupcao(sessao, escuta, relogio, porBaixo);
    // 500 ms de silêncio até o agente começar, e a janela inteira de ruído.
    expect(sessao.bytesRecebidos).toBe((500 + JANELA_S * 1000) * BYTES_POR_MS);
  });

  it("o agente que não fala não conta nada", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, false);
    const r = await medirInterrupcao(sessao, escuta, relogio, porBaixo);
    expect(r).toMatchObject({ agenteNaoFalou: true, interrupcoes: 0 });
  });
});

describe("medirFraseLonga", () => {
  // Fala de 1 s a 13 s (12 s), e a cauda de ruído até 33 s.
  const longa = frase(1000, 13000, 33000);

  it("acusa a guarda que age antes de a frase acabar (o provedor só dá início de fala, sem texto, como o OpenAI)", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    relogio.agendar(() => sessao.emitir("callerActivity", { words: false }), 1200);
    const r = await medirFraseLonga(sessao, escuta, relogio, longa);

    expect(r.guardaAntesDoFim).toBe(true);
    expect(r.guardaEmMs).toBe(200 + WITHOUT_WORDS_MS);
    expect(r.duracaoDaFalaMs).toBe(12000);
  });

  it("não acusa a guarda que espera: com texto novo a cada segundo, ela só age depois do fim", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    for (let t = 1500; t <= 13000; t += 1000) relogio.agendar(() => sessao.emitir("callerActivity", { words: true }), t);
    sessao.aoFecharOTurno = () => relogio.agendar(() => sessao.emitir("audio", audioDoAgente(800)), 400);
    const r = await medirFraseLonga(sessao, escuta, relogio, longa);

    expect(r.guardaAntesDoFim).toBe(false);
    // O último texto chegou aos 12,5 s; a guarda fecha o turno 2,5 s depois, e o agente responde 400 ms depois.
    expect(r.guardaEmMs).toBe(12500 + AFTER_WORDS_MS - 1000);
    expect(r.respostaMs).toBe(12500 + AFTER_WORDS_MS + 400 - 13000);
  });

  it("toca a frase inteira mesmo que o agente fale no meio dela", async () => {
    const relogio = relogioFalso();
    const sessao = new SessaoFalsa();
    const escuta = escutar(sessao, motorFalso, relogio, true);
    relogio.agendar(() => sessao.emitir("audio", audioDoAgente(500)), 5000);
    relogio.agendar(() => sessao.emitir("audio", audioDoAgente(500)), 14000);
    const r = await medirFraseLonga(sessao, escuta, relogio, longa);
    expect(r.antecipou).toBe(true);
    expect(r.respostaMs).toBe(1000);
    expect(sessao.bytesRecebidos).toBe(14000 * BYTES_POR_MS);
  });
});

/** Um motor de hoje falso: responde a cada item logo depois do primeiro áudio, e manda `usage` de 1 s. */
function motorDeHojeFalso(id: string, variavel: string, opcoes: { noisyNaoAbre?: boolean; calado?: boolean } = {}) {
  const sessoes: SessaoFalsa[] = [];
  const configs: VoiceSessionConfig[] = [];
  let carregou = 0;
  const motor: MotorDeHoje = {
    id,
    rotulo: `Motor ${id}`,
    modelo: `modelo-${id}`,
    variavelDaChave: variavel,
    piorCasoUsdPorMinuto: 0.6,
    fontePreco: "teste",
    conferidoEm: "2026-11-15",
    carregar: async () => {
      carregou++;
      return {
        ...motorFalso,
        connect: async (config: VoiceSessionConfig) => {
          configs.push(config);
          if (opcoes.noisyNaoAbre && config.listeningEnvironment === "noisy") throw new Error("setup recusado");
          const sessao = new SessaoFalsa();
          let respondeu = false;
          const responder = (): void => {
            if (respondeu) return;
            respondeu = true;
            sessao.emitir("audio", audioDoAgente(500));
            sessao.emitir("usage", { seconds: 1 });
          };
          if (opcoes.calado) {
            // Não responde nunca, e o provedor só dá um início de fala sem texto aos 200 ms (como o OpenAI).
            sessao.aoReceber = (bytes) => bytes === 200 * BYTES_POR_MS && sessao.emitir("callerActivity", { words: false });
          } else {
            sessao.aoReceber = (bytes) => bytes === 320 && responder();
            sessao.aoFalar = responder;
          }
          sessoes.push(sessao);
          return sessao;
        },
      } as unknown as VoiceEngine;
    },
  };
  return { motor, sessoes, configs, carregou: () => carregou };
}

const planoPequeno: Plano = {
  nFrases: 1,
  frases: [frase(200, 800, 1000)],
  porBaixo: [{ caso: "uhum", snrDb: null, pcm8k: Buffer.alloc(JANELA_S * 1000 * BYTES_POR_MS) }],
  longas: [frase(200, 12200, 13000)],
};

function rodadaFalsa(motores: MotorDeHoje[], ambiente: NodeJS.ProcessEnv) {
  const saida: string[] = [];
  let planos = 0;
  return {
    saida,
    planos: () => planos,
    pecas: {
      motores,
      montarPlano: async () => {
        planos++;
        return planoPequeno;
      },
      relogio: relogioFalso(),
      hoje: () => "2026-11-15",
      saida: (l: string) => saida.push(l),
      progresso: () => undefined,
      ambiente,
    },
  };
}

describe("bancadaContraOProvedor", () => {
  it("sem chave: os dois motores saem como \"chave não entregue\", sem áudio, sem sessão e com gasto zero", async () => {
    const openai = motorDeHojeFalso("openai-hoje", "BANCADA_OPENAI_API_KEY");
    const gemini = motorDeHojeFalso("gemini-hoje", "BANCADA_GEMINI_API_KEY");
    const r = rodadaFalsa([openai.motor, gemini.motor], {});
    await bancadaContraOProvedor(["--teto-usd", "5"], r.pecas);
    const texto = r.saida.join("\n");

    expect(texto).toContain("Motor openai-hoje** (modelo-openai-hoje; pior caso de US$ 0.6/min, teste, conferido em 2026-11-15): chave não entregue (`BANCADA_OPENAI_API_KEY`)");
    expect(texto).toContain("chave não entregue (`BANCADA_GEMINI_API_KEY`)");
    expect(texto).toContain("Total: US$ 0.0000 de US$ 5");
    expect(texto).toContain("Medida contra o provedor (2026-11-15)");
    expect(r.planos()).toBe(0);
    expect(openai.carregou() + gemini.carregou()).toBe(0);
  });

  it("sem --teto-usd não roda", async () => {
    const r = rodadaFalsa([motorDeHojeFalso("openai-hoje", "BANCADA_OPENAI_API_KEY").motor], {});
    await expect(bancadaContraOProvedor([], r.pecas)).rejects.toThrow(/--teto-usd é obrigatório/);
  });

  it("com chave: mede normal e noisy, com e sem guarda, e escreve o custo real do `usage`, com data e modelo", async () => {
    const openai = motorDeHojeFalso("openai-hoje", "BANCADA_OPENAI_API_KEY");
    const r = rodadaFalsa([openai.motor], { BANCADA_OPENAI_API_KEY: "openai-chave-falsa-5555eeee" });
    await bancadaContraOProvedor(["--teto-usd", "5"], r.pecas);
    const texto = r.saida.join("\n");

    // 2 ambientes × (2 guardas × (1 frase + 1 caso por baixo) + 1 frase longa com a guarda) = 10 sessões.
    expect(openai.sessoes).toHaveLength(10);
    expect(openai.sessoes.every((s) => s.fechada)).toBe(true);
    expect(openai.configs.map((c) => c.listeningEnvironment)).toEqual([...Array(5).fill("normal"), ...Array(5).fill("noisy")]);
    // 1 s de `usage` a 1 centavo por segundo, em cada sessão.
    expect(texto).toContain("Custo real (`usage` do provedor): openai-hoje US$ 0.1000. Total: US$ 0.1000 de US$ 5.");
    expect(texto).toContain("### Motor openai-hoje, 2026-11-15");
    expect(texto).toContain("modelo-openai-hoje");
    expect(texto).not.toContain("openai-chave-falsa-5555eeee");
  });

  it("para antes de passar do teto: o item cujo pior caso não cabe não abre sessão", async () => {
    const openai = motorDeHojeFalso("openai-hoje", "BANCADA_OPENAI_API_KEY");
    const r = rodadaFalsa([openai.motor], { BANCADA_OPENAI_API_KEY: "openai-chave-falsa-5555eeee" });
    // Cabe o pior caso da primeira frase (e o gasto real dela), e não cabe o do item seguinte.
    const teto = piorCasoDoItem(openai.motor, "resposta", planoPequeno.frases[0]?.pcm8k) + 0.01;
    await bancadaContraOProvedor(["--teto-usd", String(teto)], r.pecas);
    const texto = r.saida.join("\n");

    expect(openai.sessoes).toHaveLength(1);
    expect(texto).toContain("A rodada parou antes do fim:** openai-hoje, interrupcao, normal, sem guarda: parou no teto");
  });

  it("a frase longa da rodada roda com a guarda: com o motor calado, a guarda age antes do fim e a tabela diz isso", async () => {
    const openai = motorDeHojeFalso("openai-hoje", "BANCADA_OPENAI_API_KEY", { calado: true });
    const r = rodadaFalsa([openai.motor], { BANCADA_OPENAI_API_KEY: "openai-chave-falsa-5555eeee" });
    await bancadaContraOProvedor(["--teto-usd", "5", "--partes", "longa"], r.pecas);
    const texto = r.saida.join("\n");

    expect(openai.sessoes).toHaveLength(2);
    // Início de fala sem texto junto do início da fala (200 ms); a guarda fecha o turno 8 s depois, antes do fim (12,2 s).
    expect(texto).toContain(`| normal | obra | 5 | 12.0 | **sim** | ${WITHOUT_WORDS_MS} |`);
    expect(texto).toContain(`| noisy | obra | 5 | 12.0 | **sim** | ${WITHOUT_WORDS_MS} |`);
  });

  it("a sessão noisy que não abre fica anotada, e o normal é medido", async () => {
    const gemini = motorDeHojeFalso("gemini-hoje", "BANCADA_GEMINI_API_KEY", { noisyNaoAbre: true });
    const r = rodadaFalsa([gemini.motor], { BANCADA_GEMINI_API_KEY: "gemini-chave-falsa-6666ffff" });
    await bancadaContraOProvedor(["--teto-usd", "5"], r.pecas);
    const texto = r.saida.join("\n");

    expect(gemini.sessoes).toHaveLength(5);
    // Uma tentativa só: depois de não abrir, o ambiente não é tentado de novo.
    expect(gemini.configs.filter((c) => c.listeningEnvironment === "noisy")).toHaveLength(1);
    expect(texto).toContain("gemini-hoje: a sessão `noisy` não abriu (setup recusado); esse ambiente ficou sem medida.");
  });
});
