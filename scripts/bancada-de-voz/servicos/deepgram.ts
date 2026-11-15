/**
 * Deepgram Nova-3, em streaming, falando direto com o serviço (sem SDK).
 *
 * Fontes, conferidas em 15/11/2026:
 * - idiomas: developers.deepgram.com/docs/models-languages-overview. O Nova-3 monolíngue lista
 *   "Portuguese: pt, pt-BR, pt-PT", e o modelo serve "batch or streaming";
 * - protocolo: developers.deepgram.com/reference/speech-to-text/listen-streaming
 *   (`wss://api.deepgram.com/v1/listen`, mensagens `Results`, `Metadata`, `Error`, e `CloseStream`
 *   para fechar);
 * - vocabulário: developers.deepgram.com/docs/keyterm. `keyterm` repetido na URL, no Nova-3
 *   monolíngue e multilíngue, até 100 termos e 500 tokens somados;
 * - preço: deepgram.com/pricing. Streaming pré-pago: US$ 0,0048 por minuto (monolíngue), mais
 *   US$ 0,0013 por minuto de keyterm. A bancada conta US$ 0,0061 nos dois modos (com e sem
 *   vocabulário): sobra no "sem", e nunca falta.
 *
 * Chave: `BANCADA_DEEPGRAM_API_KEY`, no cabeçalho `Authorization: Token <chave>`. O serviço não
 * declara o custo na sessão, e a bancada estima pela duração do áudio enviado.
 */
import { z } from "../dependencias";
import type { Linha } from "../linhas";
import { abrirSocket, aberto, erroDoServico, esperarFechamento, leitorDaChave, lerMensagem, motivoSemChave, type OpcoesDoExterno } from "./_externo";
import type { ServicoMedido } from "./tipos";

export const VARIAVEL_DA_CHAVE = "BANCADA_DEEPGRAM_API_KEY";
const URL_PADRAO = "wss://api.deepgram.com/v1/listen";
const MODELO = "nova-3";
const MAX_TERMOS = 100;

const Mensagem = z.union([
  z.object({
    type: z.literal("Results"),
    is_final: z.boolean(),
    channel: z.object({ alternatives: z.array(z.object({ transcript: z.string() })) }),
  }),
  z.object({ type: z.literal("Metadata") }),
  z.object({ type: z.literal("Error"), variant: z.string().optional(), description: z.string().optional() }),
]);

/** A URL de uma sessão: modelo, idioma, áudio cru, texto parcial e o vocabulário em `keyterm`. */
export function urlDaSessao(base: string, idioma: string, taxaHz: number, vocabulario: readonly string[]): string {
  const url = new URL(base);
  const parametros: Record<string, string> = {
    model: MODELO,
    language: idioma,
    encoding: "linear16",
    sample_rate: String(taxaHz),
    channels: "1",
    interim_results: "true",
    punctuate: "true",
    smart_format: "true",
  };
  for (const [nome, valor] of Object.entries(parametros)) url.searchParams.set(nome, valor);
  for (const termo of vocabulario.slice(0, MAX_TERMOS)) url.searchParams.append("keyterm", termo);
  return url.toString();
}

export function criarDeepgram(opcoes: OpcoesDoExterno = {}): ServicoMedido {
  const lerChave = leitorDaChave(VARIAVEL_DA_CHAVE, opcoes);
  const base = opcoes.url ?? URL_PADRAO;
  const entrega = (linha: Linha) => (linha === "estreita" ? { taxaHz: 8000 as const, mulaw: false } : { taxaHz: 16000 as const, mulaw: false });
  return {
    id: "deepgram",
    rotulo: "Deepgram Nova-3 (streaming)",
    modelo: `${MODELO}, pt-BR`,
    preco: { usdPorMinuto: 0.0061, fonte: "deepgram.com/pricing (streaming pré-pago US$ 0,0048 + keyterm US$ 0,0013 por minuto)", conferidoEm: "2026-11-15" },
    entrega,
    indisponivel: () => (lerChave() ? null : motivoSemChave(VARIAVEL_DA_CHAVE)),
    async abrir(config, linha, eventos, relogio) {
      const chave = lerChave();
      const socket = await abrirSocket("deepgram", urlDaSessao(base, config.idioma, entrega(linha).taxaHz, config.vocabulario), { Authorization: `Token ${chave ?? ""}` }, chave);
      let fechando = false;
      socket.on("message", (dado, binario) => {
        let mensagem: z.infer<typeof Mensagem>;
        try {
          mensagem = lerMensagem("deepgram", Mensagem, dado, binario);
        } catch (erro) {
          eventos.erro(erro as Error);
          return;
        }
        if (mensagem.type === "Error") eventos.erro(erroDoServico("deepgram", `${mensagem.variant ?? "Error"}: ${mensagem.description ?? ""}`, chave));
        if (mensagem.type !== "Results") return;
        const texto = mensagem.channel.alternatives[0]?.transcript.trim() ?? "";
        if (!texto) return;
        if (mensagem.is_final) eventos.final(texto, relogio.agora());
        else eventos.parcial(texto, relogio.agora());
      });
      socket.on("close", (codigo) => {
        if (!fechando) eventos.erro(erroDoServico("deepgram", `fechou a conexão no meio (código ${codigo})`, chave));
      });
      return {
        enviar: (pcm16) => {
          if (aberto(socket)) socket.send(pcm16);
        },
        async fechar() {
          fechando = true;
          if (aberto(socket)) socket.send(JSON.stringify({ type: "CloseStream" }));
          await esperarFechamento(socket);
          return { custoUsd: null };
        },
      };
    },
  };
}

export default criarDeepgram();
