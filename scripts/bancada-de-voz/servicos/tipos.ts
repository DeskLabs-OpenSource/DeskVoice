/**
 * O contrato de um serviço medido pela bancada. Um arquivo por serviço nesta pasta, com fonte e
 * data no cabeçalho. A bancada descobre os serviços pela pasta (todo `.ts` que não é este nem
 * teste exporta um `ServicoMedido` como `default`).
 */
import type { Entrega, Linha } from "../linhas";
import type { Relogio } from "../tempo-real";

export interface Preco {
  /** US$ por minuto de áudio enviado. Zero para o que roda na VPS (o custo é CPU). */
  usdPorMinuto: number;
  fonte: string;
  conferidoEm: string;
}

export interface EventosDaSessao {
  /** Texto parcial. `texto` pode vir vazio quando o serviço só avisa que há texto novo. */
  parcial(texto: string, instanteMs: number): void;
  /** Um trecho que o serviço não muda mais. A frase pode vir em mais de um. */
  final(texto: string, instanteMs: number): void;
  erro(erro: Error): void;
}

export interface SessaoDoServico {
  /** Um pedaço de 20 ms, na taxa da entrega. */
  enviar(pcm16: Buffer): void;
  /** Fecha a sessão. Devolve o custo que o serviço declarou, ou nulo para a bancada estimar pelo preço. */
  fechar(): Promise<{ custoUsd: number | null }>;
}

export interface ServicoMedido {
  id: string;
  rotulo: string;
  modelo: string;
  preco: Preco;
  /** Como o serviço recebe cada linha. Nulo: a linha não é medida neste serviço (e a tabela diz). */
  entrega(linha: Linha): Entrega | null;
  /** Nulo se pode rodar; senão, o motivo (sem chave, sem binário). Vira "não medido" na tabela. */
  indisponivel(): string | null;
  /** Carrega o que for pesado uma vez (modelo local). */
  preparar?(): Promise<void>;
  encerrar?(): Promise<void>;
  abrir(config: { idioma: string; vocabulario: readonly string[] }, linha: Linha, eventos: EventosDaSessao, relogio: Relogio): Promise<SessaoDoServico>;
}

export function ehServicoMedido(valor: unknown): valor is ServicoMedido {
  const v = valor as Partial<ServicoMedido> | null;
  return !!v && typeof v.id === "string" && typeof v.abrir === "function" && typeof v.entrega === "function" && typeof v.indisponivel === "function";
}
