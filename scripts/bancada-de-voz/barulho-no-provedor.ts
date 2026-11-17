/**
 * A medida contra o provedor do ambiente barulhento (fatia 5 do desenho da DESA-24,
 * docs/specs/2026-11-14-ambiente-barulhento.md, PR #182). Para cada motor de hoje (OpenAI Realtime e
 * Gemini Live), para `normal` e `noisy`, com e sem a guarda contra o silêncio
 * (`apps/voice/src/silence-guard.ts`, com os prazos de hoje):
 *
 * 1. **resposta:** frase sintética misturada a obra, música e conversa. Mede o tempo entre o fim da
 *    fala e o primeiro áudio do agente, e se a guarda agiu;
 * 2. **interrupção:** o agente fala, e por baixo vai só ruído, música ou "uhum". Conta os `interrupted`
 *    **do motor** que chegam enquanto o áudio do agente ainda tocaria;
 * 3. **frase longa:** uma frase de 12 s ou mais sobre ruído contínuo. A guarda não pode agir antes
 *    de ela acabar.
 *
 * Este arquivo é a lógica, testada sem rede (`barulho-no-provedor.test.ts`, com sessão falsa e
 * relógio falso). Quem liga as peças de verdade (motor, Piper, relógio do sistema) é
 * `ambiente-barulhento.ts`.
 *
 * O áudio sai no ritmo do relógio (`tempo-real.ts`), em pedaços de 20 ms a 8 kHz, como a ponte
 * manda; o motor faz a conversão dele (μ-law no OpenAI). O teto (`orcamento.ts`) é obrigatório, e o
 * pior caso de cada item é reservado **antes** de abrir a sessão dele. O custo escrito é o do
 * `usage` que o provedor devolve.
 *
 * Sem a chave de um motor no ambiente, ele sai como "chave não entregue": nem áudio é gerado, nem
 * sessão é aberta.
 */
import type { Clock } from "../../packages/core/src/types";
import type { ListeningEnvironment, VoiceEngine, VoiceSession } from "../../packages/voice-engine/src/types";
import { createSilenceGuard, type CallerUnanswered } from "../../apps/voice/src/silence-guard";
import type { Schedule } from "../../apps/voice/src/transport";
import { Orcamento } from "./orcamento";
import { semAsChaves } from "./rodada";
import type { TipoDeRuido } from "./ruido";
import { custoEmDolares, type MotorDeHoje } from "./servicos/_motor-de-hoje";
import { LIMITE_FORA_DO_RITMO_MS, PEDACO_MS, enviarEmTempoReal, type Relogio } from "./tempo-real";

/** A ponte entrega PCM16 mono a 8 kHz: 16 bytes por milissegundo. */
export const TAXA_DO_MOTOR = 8000;
const BYTES_POR_MS = (TAXA_DO_MOTOR * 2) / 1000;

export const AMBIENTES: readonly ListeningEnvironment[] = ["normal", "noisy"];
export const PARTES = ["resposta", "interrupcao", "longa"] as const;
export type Parte = (typeof PARTES)[number];

/** Ruído antes da fala, para o provedor ouvir o fundo antes de a pessoa falar. */
export const ANTES_S = 1;
/** Ruído depois da fala: quanto a bancada espera o agente responder antes de dar "sem resposta". */
export const CAUDA_S = 20;
/** Depois do primeiro áudio do agente, quanto a bancada espera o `usage` da resposta antes de fechar. */
export const ESPERA_DO_FIM_S = 8;
/** Na interrupção: quanto a bancada espera o agente começar a falar depois do `say`. */
export const ESPERA_DA_FALA_S = 10;
/** Na interrupção: quanto tempo de ruído vai por baixo da fala do agente. */
export const JANELA_S = 12;
/** A frase longa precisa durar ao menos isto (o desenho pede 12 s). */
export const FRASE_LONGA_S = 12;
/** A cada quanto a bancada confere se o `usage` chegou. */
const PASSO_DA_ESPERA_MS = 50;

export const INSTRUCOES =
  "Você atende o telefone de uma empresa. Responda sempre em português, numa frase curta e simpática, ao que a pessoa disser. Se não entender, peça para repetir.";

/** A fala do agente por cima da qual vai o ruído na medida da interrupção (uns 10 s). */
export const FALA_DO_AGENTE =
  "Claro, vou explicar com calma. O nosso atendimento funciona de segunda a sexta, das oito da manhã às seis da tarde, e aos sábados até o meio-dia. Se preferir, também posso anotar o seu pedido agora e alguém retorna amanhã cedo.";

/** O relógio da bancada com agenda: a guarda agenda os prazos dela nele. */
export interface RelogioComAgenda extends Relogio {
  agendar: Schedule;
}

/** Uma frase pronta para tocar: fala sintética no meio do ruído, já a 8 kHz, com a cauda de ruído. */
export interface AudioDaFrase {
  id: string;
  pcm8k: Buffer;
  /** Onde a fala começa e acaba no áudio, em ms desde o início. */
  falaInicioMs: number;
  falaFimMs: number;
  ruido: { tipo: TipoDeRuido; snrDb: number; snrMedidoDb: number };
}

/** O que vai por baixo da fala do agente: só ruído (no nível pedido) ou "uhum" (sem nível). */
export interface AudioPorBaixo {
  caso: TipoDeRuido | "uhum";
  /** Relação com a voz de referência (dB), ou nulo no "uhum", que vai no nível da voz. */
  snrDb: number | null;
  /** Ao menos `JANELA_S` de áudio. */
  pcm8k: Buffer;
}

export interface Plano {
  frases: AudioDaFrase[];
  porBaixo: AudioPorBaixo[];
  longas: AudioDaFrase[];
  /** Quantas frases do conjunto entraram (cada uma em cada ruído e nível). */
  nFrases: number;
}

export interface OpcoesDoPlano {
  nFrases: number;
  niveis: readonly number[];
  partes: readonly Parte[];
}

export interface PecasDaBancada {
  motores: readonly MotorDeHoje[];
  /** Gera o áudio (Piper). Só é chamada se algum motor tiver chave. */
  montarPlano(opcoes: OpcoesDoPlano): Promise<Plano>;
  relogio: RelogioComAgenda;
  /** O dia da rodada (AAAA-MM-DD), escrito na tabela. */
  hoje(): string;
  saida(linha: string): void;
  progresso(texto: string): void;
  ambiente?: NodeJS.ProcessEnv;
}

/** Uma ação da guarda, com o instante (relógio da bancada) em que aconteceu. */
export interface AcaoDaGuarda {
  acao: CallerUnanswered["action"];
  emMs: number;
}

/** O que a bancada ouve de uma sessão, do jeito que `call-session.ts` liga a guarda. */
export interface Escuta {
  primeiroAudioMs: number | null;
  /** Até quando o áudio do agente que já chegou ainda estaria tocando na ligação. */
  tocandoAteMs: number;
  /** Milissegundos de áudio do agente recebidos. */
  audioDoAgenteMs: number;
  /** `interrupted` do motor enquanto o áudio do agente tocaria (a interrupção que se ouve). */
  interrupcoesDuranteAFala: number;
  /** `interrupted` do motor com o agente calado (o OpenAI manda um a cada início de fala). */
  interrupcoesForaDaFala: number;
  acoes: AcaoDaGuarda[];
  usageDepoisDoAudio: boolean;
  custoUsd: number;
  erros: string[];
  /** O instante de cada pedaço de áudio do agente. */
  audiosEmMs: number[];
  /** Para a guarda (fim do item): nenhum prazo dela dispara depois. */
  pararGuarda(): void;
}

/**
 * Liga a sessão à escuta e, com `comGuarda`, à guarda contra o silêncio, do mesmo jeito que
 * `apps/voice/src/call-session.ts` liga (áudio do agente com a duração dele, `interrupted` que limpa
 * o que faltava tocar, `closeCallerTurn` e `say` da própria sessão). Sem ferramentas: a bancada não
 * oferece nenhuma.
 */
export function escutar(sessao: VoiceSession, motor: VoiceEngine, relogio: RelogioComAgenda, comGuarda: boolean): Escuta {
  const escuta: Escuta = {
    primeiroAudioMs: null,
    tocandoAteMs: 0,
    audioDoAgenteMs: 0,
    interrupcoesDuranteAFala: 0,
    interrupcoesForaDaFala: 0,
    acoes: [],
    usageDepoisDoAudio: false,
    custoUsd: 0,
    erros: [],
    audiosEmMs: [],
    pararGuarda: () => undefined,
  };
  const relogioDaGuarda: Clock = { now: () => new Date(relogio.agora()) };
  const guarda = comGuarda
    ? createSilenceGuard({
        clock: relogioDaGuarda,
        schedule: relogio.agendar,
        closeCallerTurn: () => sessao.closeCallerTurn(),
        say: (texto) => sessao.say(texto),
        acted: (relato) => escuta.acoes.push({ acao: relato.action, emMs: relogio.agora() }),
      })
    : null;
  sessao.on("callerActivity", (sinal) => guarda?.callerActivity(sinal));
  sessao.on("audio", (pcm) => {
    const agora = relogio.agora();
    const duracaoMs = pcm.length / BYTES_POR_MS;
    escuta.primeiroAudioMs ??= agora;
    escuta.audiosEmMs.push(agora);
    escuta.audioDoAgenteMs += duracaoMs;
    escuta.tocandoAteMs = Math.max(agora, escuta.tocandoAteMs) + duracaoMs;
    guarda?.agentAudio(duracaoMs);
  });
  sessao.on("interrupted", () => {
    const agora = relogio.agora();
    if (agora < escuta.tocandoAteMs) escuta.interrupcoesDuranteAFala++;
    else escuta.interrupcoesForaDaFala++;
    // A ponte descarta o que faltava tocar: o agente para de falar agora.
    escuta.tocandoAteMs = Math.min(escuta.tocandoAteMs, agora);
    guarda?.agentInterrupted();
  });
  sessao.on("usage", (uso) => {
    escuta.custoUsd += custoEmDolares(motor.pricing, uso);
    if (escuta.primeiroAudioMs !== null) escuta.usageDepoisDoAudio = true;
  });
  sessao.on("error", (erro) => escuta.erros.push(erro.message));
  escuta.pararGuarda = () => guarda?.stop();
  return escuta;
}

/** Espera o `usage` da resposta (ou `ESPERA_DO_FIM_S`), para o custo real da resposta entrar na conta. */
async function esperarOFimDaResposta(escuta: Escuta, relogio: Relogio): Promise<void> {
  const limite = relogio.agora() + ESPERA_DO_FIM_S * 1000;
  while (!escuta.usageDepoisDoAudio && relogio.agora() < limite) await relogio.esperarAte(relogio.agora() + PASSO_DA_ESPERA_MS);
}

/** O instante (relógio da bancada) em que sai o pedaço que leva a última amostra da fala. */
function instanteDoFim(inicioMs: number, falaFimMs: number): number {
  return inicioMs + Math.ceil(falaFimMs / PEDACO_MS) * PEDACO_MS;
}

export interface ResultadoDaResposta {
  /** Do fim da fala ao primeiro áudio do agente. Nulo sem resposta, com resposta antes do fim, ou fora do ritmo. */
  respostaMs: number | null;
  semResposta: boolean;
  /** O agente começou a falar antes de a frase acabar (respondeu ao ruído, ou cortou a pessoa). */
  antecipou: boolean;
  guardaFechou: boolean;
  guardaPediuRepetir: boolean;
  foraDoRitmo: boolean;
}

/** Parte 1: toca a frase no ritmo da ligação e mede do fim da fala ao primeiro áudio do agente. */
export async function medirResposta(sessao: VoiceSession, escuta: Escuta, relogio: Relogio, frase: AudioDaFrase): Promise<ResultadoDaResposta> {
  const envio = await enviarEmTempoReal(frase.pcm8k, TAXA_DO_MOTOR, (p) => sessao.sendAudio(p), relogio, () => escuta.primeiroAudioMs !== null);
  const fimDaFala = instanteDoFim(envio.inicioMs, frase.falaFimMs);
  const primeiro = escuta.primeiroAudioMs;
  if (primeiro !== null) await esperarOFimDaResposta(escuta, relogio);
  escuta.pararGuarda();
  const foraDoRitmo = envio.atrasoMaxMs > LIMITE_FORA_DO_RITMO_MS;
  const antecipou = primeiro !== null && primeiro < fimDaFala;
  return {
    respostaMs: primeiro !== null && !antecipou && !foraDoRitmo ? primeiro - fimDaFala : null,
    semResposta: primeiro === null,
    antecipou,
    guardaFechou: escuta.acoes.some((a) => a.acao === "turn_closed"),
    guardaPediuRepetir: escuta.acoes.some((a) => a.acao === "asked_to_repeat"),
    foraDoRitmo,
  };
}

export interface ResultadoDaInterrupcao {
  /** O agente não começou a falar em `ESPERA_DA_FALA_S`: nada foi contado. */
  agenteNaoFalou: boolean;
  interrupcoes: number;
  /** Milissegundos de fala do agente que tocariam dentro da janela de ruído. */
  falaDoAgenteMs: number;
  guardaAgiu: boolean;
  foraDoRitmo: boolean;
}

/**
 * Parte 2: o agente fala (`say`), e por baixo vai só ruído, música ou "uhum". Conta o evento
 * `interrupted` do motor, e não o áudio que parou: o áudio para também quando a fala acaba.
 */
export async function medirInterrupcao(sessao: VoiceSession, escuta: Escuta, relogio: Relogio, porBaixo: AudioPorBaixo): Promise<ResultadoDaInterrupcao> {
  sessao.say(FALA_DO_AGENTE);
  // Enquanto o agente não fala, a ligação manda silêncio, como a ponte manda.
  const silencio = Buffer.alloc(ESPERA_DA_FALA_S * 1000 * BYTES_POR_MS);
  const espera = await enviarEmTempoReal(silencio, TAXA_DO_MOTOR, (p) => sessao.sendAudio(p), relogio, () => escuta.primeiroAudioMs !== null);
  if (escuta.primeiroAudioMs === null) {
    escuta.pararGuarda();
    return { agenteNaoFalou: true, interrupcoes: 0, falaDoAgenteMs: 0, guardaAgiu: escuta.acoes.length > 0, foraDoRitmo: espera.atrasoMaxMs > LIMITE_FORA_DO_RITMO_MS };
  }
  const antes = escuta.interrupcoesDuranteAFala;
  const janela = porBaixo.pcm8k.subarray(0, JANELA_S * 1000 * BYTES_POR_MS);
  const envio = await enviarEmTempoReal(janela, TAXA_DO_MOTOR, (p) => sessao.sendAudio(p), relogio);
  const fimDaJanela = envio.fimMs;
  // A fala do agente que tocaria na janela: do primeiro áudio até onde ela pararia (no fim, ou na interrupção).
  const falaDoAgenteMs = Math.max(0, Math.min(escuta.tocandoAteMs, fimDaJanela) - (escuta.primeiroAudioMs ?? fimDaJanela));
  await esperarOFimDaResposta(escuta, relogio);
  escuta.pararGuarda();
  return {
    agenteNaoFalou: false,
    interrupcoes: escuta.interrupcoesDuranteAFala - antes,
    falaDoAgenteMs,
    guardaAgiu: escuta.acoes.length > 0,
    foraDoRitmo: Math.max(espera.atrasoMaxMs, envio.atrasoMaxMs) > LIMITE_FORA_DO_RITMO_MS,
  };
}

export interface ResultadoDaFraseLonga {
  duracaoDaFalaMs: number;
  /** A guarda agiu antes de a frase acabar: é o defeito que esta parte procura. */
  guardaAntesDoFim: boolean;
  /** Quando a guarda agiu pela primeira vez, em ms desde o início da fala. Nulo se não agiu. */
  guardaEmMs: number | null;
  /** Do fim da fala ao primeiro áudio do agente depois dele. Nulo sem resposta. */
  respostaMs: number | null;
  /** O agente falou antes de a frase acabar. */
  antecipou: boolean;
  foraDoRitmo: boolean;
}

/** Parte 3: a frase longa toca inteira (mesmo que o agente fale antes), e a cauda até a resposta. */
export async function medirFraseLonga(sessao: VoiceSession, escuta: Escuta, relogio: Relogio, frase: AudioDaFrase): Promise<ResultadoDaFraseLonga> {
  const inicio = relogio.agora();
  const fimDaFala = instanteDoFim(inicio, frase.falaFimMs);
  const respondeuDepois = (): number | null => escuta.audiosEmMs.find((t) => t >= fimDaFala) ?? null;
  const envio = await enviarEmTempoReal(frase.pcm8k, TAXA_DO_MOTOR, (p) => sessao.sendAudio(p), relogio, () => respondeuDepois() !== null);
  if (envio.inicioMs !== inicio) throw new Error("o envio começou fora do instante esperado");
  if (escuta.primeiroAudioMs !== null) await esperarOFimDaResposta(escuta, relogio);
  escuta.pararGuarda();
  const primeiraAcao = escuta.acoes[0];
  const respostaDepois = respondeuDepois();
  const inicioDaFala = inicio + frase.falaInicioMs;
  return {
    duracaoDaFalaMs: frase.falaFimMs - frase.falaInicioMs,
    guardaAntesDoFim: escuta.acoes.some((a) => a.emMs < fimDaFala),
    guardaEmMs: primeiraAcao ? primeiraAcao.emMs - inicioDaFala : null,
    respostaMs: respostaDepois !== null ? respostaDepois - fimDaFala : null,
    antecipou: escuta.primeiroAudioMs !== null && escuta.primeiroAudioMs < fimDaFala,
    foraDoRitmo: envio.atrasoMaxMs > LIMITE_FORA_DO_RITMO_MS,
  };
}

/** Pior caso de um item, para o teto: o áudio que pode sair, mais a espera da resposta, ao preço de pior caso do motor. */
export function piorCasoDoItem(motor: Pick<MotorDeHoje, "piorCasoUsdPorMinuto">, parte: Parte, pcm8k?: Buffer): number {
  const audioS = parte === "interrupcao" ? ESPERA_DA_FALA_S + JANELA_S : (pcm8k?.length ?? 0) / BYTES_POR_MS / 1000;
  return ((audioS + ESPERA_DO_FIM_S) / 60) * motor.piorCasoUsdPorMinuto;
}

export type Linha =
  | { parte: "resposta"; ambiente: ListeningEnvironment; comGuarda: boolean; frase: AudioDaFrase; r: ResultadoDaResposta }
  | { parte: "interrupcao"; ambiente: ListeningEnvironment; comGuarda: boolean; porBaixo: AudioPorBaixo; r: ResultadoDaInterrupcao }
  | { parte: "longa"; ambiente: ListeningEnvironment; comGuarda: boolean; frase: AudioDaFrase; r: ResultadoDaFraseLonga };

interface ItemDaRodada {
  parte: Parte;
  ambiente: ListeningEnvironment;
  comGuarda: boolean;
  frase?: AudioDaFrase;
  porBaixo?: AudioPorBaixo;
}

/** Os itens de um motor, na ordem da rodada. A frase longa só roda com a guarda: é ela que se confere. */
export function itensDoMotor(plano: Plano, partes: readonly Parte[]): ItemDaRodada[] {
  const itens: ItemDaRodada[] = [];
  for (const ambiente of AMBIENTES)
    for (const comGuarda of [false, true]) {
      if (partes.includes("resposta")) for (const frase of plano.frases) itens.push({ parte: "resposta", ambiente, comGuarda, frase });
      if (partes.includes("interrupcao")) for (const porBaixo of plano.porBaixo) itens.push({ parte: "interrupcao", ambiente, comGuarda, porBaixo });
      if (partes.includes("longa") && comGuarda) for (const frase of plano.longas) itens.push({ parte: "longa", ambiente, comGuarda, frase });
    }
  return itens;
}

function argumento(argv: readonly string[], nome: string): string | undefined {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function lista(argv: readonly string[], nome: string, padrao: readonly string[]): string[] {
  const valor = argumento(argv, nome);
  return valor ? valor.split(",").map((s) => s.trim()).filter(Boolean) : [...padrao];
}

function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)] ?? null;
}

const ms = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));
const guardaTexto = (comGuarda: boolean): string => (comGuarda ? "com" : "sem");

/**
 * A tabela da parte 1. A mediana e o p90 contam só as frases em que a guarda não pediu para
 * repetir: nelas o primeiro áudio é o pedido da guarda, e o tempo mediria a guarda, e não o motor.
 * Quando a guarda só fecha o turno, a frase fica, porque quem responde é o motor. "Frases" é o total
 * do grupo, e "Na mediana" é quantas entraram na conta.
 */
export function tabelaDaResposta(linhas: Linha[]): string[] {
  const grupos = new Map<string, Extract<Linha, { parte: "resposta" }>[]>();
  for (const l of linhas) {
    if (l.parte !== "resposta") continue;
    const chave = [l.ambiente, guardaTexto(l.comGuarda), l.frase.ruido.tipo, l.frase.ruido.snrDb].join("|");
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }
  if (grupos.size === 0) return [];
  const out = [
    "",
    "**1. Resposta** (do fim da fala ao primeiro áudio do agente, em ms)",
    "",
    "| Ambiente | Guarda | Ruído | dB | Frases | Na mediana | Mediana | p90 | Sem resposta | Antecipou | Guarda fechou o turno | Guarda pediu para repetir | Fora do ritmo |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [chave, ls] of grupos) {
    const [ambiente, guarda, tipo, snr] = chave.split("|");
    const tempos = ls.flatMap((l) => (l.r.respostaMs === null || l.r.guardaPediuRepetir ? [] : [l.r.respostaMs]));
    const conta = (f: (r: ResultadoDaResposta) => boolean): number => ls.filter((l) => f(l.r)).length;
    out.push(
      `| ${ambiente} | ${guarda} | ${tipo} | ${snr} | ${ls.length} | ${tempos.length} | ${ms(percentil(tempos, 50))} | ${ms(percentil(tempos, 90))} | ${conta((r) => r.semResposta)} | ${conta((r) => r.antecipou)} | ${conta((r) => r.guardaFechou)} | ${conta((r) => r.guardaPediuRepetir)} | ${conta((r) => r.foraDoRitmo)} |`,
    );
  }
  return out;
}

export function tabelaDaInterrupcao(linhas: Linha[]): string[] {
  const ls = linhas.filter((l): l is Extract<Linha, { parte: "interrupcao" }> => l.parte === "interrupcao");
  if (ls.length === 0) return [];
  const out = [
    "",
    `**2. Interrupção falsa** (o agente fala, e por baixo vai só o caso, por ${JANELA_S} s; conta o \`interrupted\` do motor enquanto o áudio do agente tocaria)`,
    "",
    "| Ambiente | Guarda | Por baixo | dB | Interrupções | Fala do agente na janela (s) | Agente não falou | Guarda agiu | Fora do ritmo |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const l of ls)
    out.push(
      `| ${l.ambiente} | ${guardaTexto(l.comGuarda)} | ${l.porBaixo.caso} | ${l.porBaixo.snrDb ?? "nível da voz"} | ${l.r.agenteNaoFalou ? "—" : l.r.interrupcoes} | ${(l.r.falaDoAgenteMs / 1000).toFixed(1)} | ${l.r.agenteNaoFalou ? "sim" : "não"} | ${l.r.guardaAgiu ? "sim" : "não"} | ${l.r.foraDoRitmo ? "sim" : "não"} |`,
    );
  return out;
}

export function tabelaDaFraseLonga(linhas: Linha[]): string[] {
  const ls = linhas.filter((l): l is Extract<Linha, { parte: "longa" }> => l.parte === "longa");
  if (ls.length === 0) return [];
  const out = [
    "",
    "**3. Frase longa sobre ruído contínuo** (com a guarda; ela não pode agir antes do fim da fala)",
    "",
    "| Ambiente | Ruído | dB | Fala (s) | Guarda agiu antes do fim | Guarda agiu em (ms desde o início da fala) | Antecipou | Resposta depois do fim (ms) | Fora do ritmo |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const l of ls)
    out.push(
      `| ${l.ambiente} | ${l.frase.ruido.tipo} | ${l.frase.ruido.snrDb} | ${(l.r.duracaoDaFalaMs / 1000).toFixed(1)} | ${l.r.guardaAntesDoFim ? "**sim**" : "não"} | ${ms(l.r.guardaEmMs)} | ${l.r.antecipou ? "sim" : "não"} | ${ms(l.r.respostaMs)} | ${l.r.foraDoRitmo ? "sim" : "não"} |`,
    );
  return out;
}

/**
 * A rodada: lê os argumentos, separa os motores sem chave, gera o áudio só se algum tiver chave,
 * reserva o pior caso de cada item antes de abrir a sessão dele, e escreve a seção da tabela.
 */
export async function bancadaContraOProvedor(argv: readonly string[], pecas: PecasDaBancada): Promise<void> {
  const ambiente = pecas.ambiente ?? process.env;
  const print = (linha: string): void => pecas.saida(semAsChaves(linha, ambiente));
  const progresso = (texto: string): void => pecas.progresso(semAsChaves(texto, ambiente));

  const tetoTexto = argumento(argv, "teto-usd");
  if (tetoTexto === undefined) throw new Error("--teto-usd é obrigatório (0 para não gastar nada)");
  const orcamento = new Orcamento(Number(tetoTexto));
  const pedidos = lista(argv, "motores", pecas.motores.map((m) => m.id));
  const desconhecido = pedidos.find((id) => !pecas.motores.some((m) => m.id === id));
  if (desconhecido) throw new Error(`motor desconhecido: ${desconhecido}`);
  const partes = lista(argv, "partes", PARTES) as Parte[];
  const parteRuim = partes.find((p) => !PARTES.includes(p));
  if (parteRuim) throw new Error(`parte desconhecida: ${parteRuim}`);
  const nFrases = Number(argumento(argv, "frases") ?? "1");
  if (!(Number.isInteger(nFrases) && nFrases > 0)) throw new Error(`--frases inválido: ${argumento(argv, "frases")}`);
  const niveis = lista(argv, "niveis", ["15", "5", "0"]).map(Number);
  if (niveis.some((n) => !Number.isFinite(n))) throw new Error(`--niveis inválido: ${argumento(argv, "niveis")}`);

  const motores = pecas.motores.filter((m) => pedidos.includes(m.id));
  const comChave = motores.filter((m) => ambiente[m.variavelDaChave]);

  print(`## Medida contra o provedor (${pecas.hoje()})`);
  print("");
  print(`Comando: \`pnpm exec tsx scripts/bancada-de-voz/ambiente-barulhento.ts ${argv.join(" ")}\`. Teto: US$ ${orcamento.tetoUsd}. Prazos da guarda: os de \`apps/voice/src/silence-guard.ts\`.`);
  for (const m of motores) {
    const sem = !ambiente[m.variavelDaChave];
    print(`- **${m.rotulo}** (${m.modelo}; pior caso de US$ ${m.piorCasoUsdPorMinuto}/min, ${m.fontePreco}, conferido em ${m.conferidoEm}): ${sem ? `chave não entregue (\`${m.variavelDaChave}\`), sem áudio e sem sessão` : "medido"}.`);
  }

  const linhasPorMotor = new Map<string, Linha[]>();
  const notas: string[] = [];
  let parouEm: string | null = null;

  if (comChave.length > 0) {
    progresso("gerando o áudio sintético");
    const plano = await pecas.montarPlano({ nFrases, niveis, partes });
    print(`- Frases: ${plano.nFrases} do conjunto, cada uma em ${plano.frases.length / Math.max(1, plano.nFrases)} misturas; ${plano.porBaixo.length} casos por baixo da fala do agente; ${plano.longas.length} frases longas.`);
    for (const m of comChave) {
      const itens = itensDoMotor(plano, partes);
      const total = itens.reduce((s, it) => s + piorCasoDoItem(m, it.parte, it.frase?.pcm8k), 0);
      print(`- Pior caso de ${m.id}: ${itens.length} itens, US$ ${total.toFixed(4)}.`);
    }

    motores: for (const m of comChave) {
      const motor = await m.carregar();
      const linhas: Linha[] = [];
      linhasPorMotor.set(m.id, linhas);
      const ambientesQueNaoAbriram = new Set<ListeningEnvironment>();
      for (const item of itensDoMotor(plano, partes)) {
        if (ambientesQueNaoAbriram.has(item.ambiente)) continue;
        const reserva = orcamento.reservar(piorCasoDoItem(m, item.parte, item.frase?.pcm8k), m.id);
        if (!reserva) {
          parouEm = `${m.id}, ${item.parte}, ${item.ambiente}, ${guardaTexto(item.comGuarda)} guarda: ${orcamento.motivoDaParada()}`;
          break motores;
        }
        let sessao: VoiceSession;
        try {
          sessao = await motor.connect(
            { instructions: INSTRUCOES, language: "pt-BR", tools: [], listeningEnvironment: item.ambiente },
            ambiente[m.variavelDaChave] ?? "",
          );
        } catch (erro) {
          reserva.fechar(0);
          const motivo = erro instanceof Error ? erro.message : String(erro);
          ambientesQueNaoAbriram.add(item.ambiente);
          notas.push(`${m.id}: a sessão \`${item.ambiente}\` não abriu (${motivo}); esse ambiente ficou sem medida.`);
          continue;
        }
        const escuta = escutar(sessao, motor, pecas.relogio, item.comGuarda);
        progresso(`${m.id} ${item.ambiente} ${guardaTexto(item.comGuarda)} guarda: ${item.parte} ${item.frase?.id ?? item.porBaixo?.caso ?? ""}`);
        try {
          if (item.parte === "resposta" && item.frase) linhas.push({ ...item, parte: "resposta", frase: item.frase, r: await medirResposta(sessao, escuta, pecas.relogio, item.frase) });
          else if (item.parte === "interrupcao" && item.porBaixo) linhas.push({ ...item, parte: "interrupcao", porBaixo: item.porBaixo, r: await medirInterrupcao(sessao, escuta, pecas.relogio, item.porBaixo) });
          else if (item.parte === "longa" && item.frase) linhas.push({ ...item, parte: "longa", frase: item.frase, r: await medirFraseLonga(sessao, escuta, pecas.relogio, item.frase) });
        } finally {
          await sessao.close();
          reserva.fechar(escuta.custoUsd);
        }
        for (const e of escuta.erros) notas.push(`${m.id} ${item.ambiente}: erro do motor: ${e}`);
        if (orcamento.excesso > 0) {
          parouEm = `${m.id}: ${orcamento.motivoDaParada()}`;
          break motores;
        }
      }
    }
  }

  for (const m of motores) {
    const linhas = linhasPorMotor.get(m.id);
    if (!linhas) continue;
    print("");
    print(`### ${m.rotulo}, ${pecas.hoje()}`);
    for (const l of [...tabelaDaResposta(linhas), ...tabelaDaInterrupcao(linhas), ...tabelaDaFraseLonga(linhas)]) print(l);
  }

  print("");
  if (parouEm) print(`**A rodada parou antes do fim:** ${parouEm}.`);
  for (const n of notas) print(`- ${n}`);
  const porMotor = new Map(orcamento.porServico());
  print(`Custo real (\`usage\` do provedor): ${motores.map((m) => `${m.id} US$ ${(porMotor.get(m.id) ?? 0).toFixed(4)}`).join("; ")}. Total: US$ ${orcamento.gasto.toFixed(4)} de US$ ${orcamento.tetoUsd}.`);
}
