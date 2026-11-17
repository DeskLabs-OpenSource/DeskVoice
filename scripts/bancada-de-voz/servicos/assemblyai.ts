/**
 * AssemblyAI Universal-Streaming, modelo multilíngue, falando direto com o serviço (sem SDK).
 *
 * Fontes, conferidas em 15/11/2026:
 * - idiomas: assemblyai.com/docs/streaming/universal-streaming/multilingual-transcription. O
 *   `universal-streaming-multilingual` cobre "English, Spanish, French, German, Italian, and
 *   Portuguese", em streaming;
 * - protocolo: assemblyai.com/docs/streaming/api-spec/streaming-websocket
 *   (`wss://streaming.assemblyai.com/v3/ws`; `speech_model`, `sample_rate`, `encoding`,
 *   `format_turns`, `keyterms_prompt`; mensagens `Begin`, `Turn`, `Termination`; `Terminate` fecha).
 *   O `Begin` devolve a configuração aplicada, e a página avisa que parâmetro desconhecido é
 *   ignorado, sem erro: por isso a sessão confere o modelo que voltou;
 * - vocabulário: `keyterms_prompt`, até 100 termos. A página só mostra o formato JSON da lista; na
 *   URL, a bancada manda essa mesma lista em JSON;
 * - preço: assemblyai.com/pricing. US$ 0,15 por hora, com keyterms sem custo a mais no multilíngue,
 *   cobrado pela **duração da sessão**, e não pelo áudio. O custo da tabela é o
 *   `session_duration_seconds` do `Termination`. Para o teto, a bancada conta o triplo por minuto
 *   de áudio, porque a sessão dura mais que o áudio (a espera pelo final, o fechamento).
 *
 * Chave: `BANCADA_ASSEMBLYAI_API_KEY`, no cabeçalho `Authorization` (sem "Bearer").
 *
 * Parcial: o primeiro `Turn` com texto. Final: o `Turn` de fim de turno já formatado (com
 * `format_turns`), porque o acerto em nomes compara maiúscula e acento. A latência do final inclui
 * a formatação.
 */
import { z } from "../dependencias";
import type { Linha } from "../linhas";
import { abrirSocket, aberto, erroDoServico, esperarFechamento, leitorDaChave, lerMensagem, motivoSemChave, type OpcoesDoExterno } from "./_externo";
import type { ServicoMedido } from "./tipos";

export const VARIAVEL_DA_CHAVE = "BANCADA_ASSEMBLYAI_API_KEY";
const URL_PADRAO = "wss://streaming.assemblyai.com/v3/ws";
const MODELO = "universal-streaming-multilingual";
const MAX_TERMOS = 100;
const USD_POR_HORA = 0.15;

const Mensagem = z.union([
  z.object({ type: z.literal("Begin"), id: z.string(), configuration: z.object({ model: z.string().optional() }).optional() }),
  z.object({
    type: z.literal("Turn"),
    transcript: z.string(),
    end_of_turn: z.boolean(),
    turn_is_formatted: z.boolean(),
    words: z.array(z.object({ text: z.string() })).optional(),
  }),
  z.object({ type: z.literal("Termination"), audio_duration_seconds: z.number(), session_duration_seconds: z.number() }),
  z.object({ error: z.string() }),
]);

export function urlDaSessao(base: string, taxaHz: number, vocabulario: readonly string[]): string {
  const url = new URL(base);
  url.searchParams.set("speech_model", MODELO);
  url.searchParams.set("sample_rate", String(taxaHz));
  url.searchParams.set("encoding", "pcm_s16le");
  url.searchParams.set("format_turns", "true");
  if (vocabulario.length > 0) url.searchParams.set("keyterms_prompt", JSON.stringify(vocabulario.slice(0, MAX_TERMOS)));
  return url.toString();
}

export function criarAssemblyAI(opcoes: OpcoesDoExterno = {}): ServicoMedido {
  const lerChave = leitorDaChave(VARIAVEL_DA_CHAVE, opcoes);
  const base = opcoes.url ?? URL_PADRAO;
  const entrega = (linha: Linha) => (linha === "estreita" ? { taxaHz: 8000 as const, mulaw: false } : { taxaHz: 16000 as const, mulaw: false });
  return {
    id: "assemblyai",
    rotulo: "AssemblyAI Universal-Streaming (multilíngue)",
    modelo: MODELO,
    preco: {
      usdPorMinuto: USD_POR_HORA / 60,
      tetoUsdPorMinuto: (3 * USD_POR_HORA) / 60,
      fonte: "assemblyai.com/pricing (US$ 0,15 por hora de sessão, keyterms inclusos no multilíngue)",
      conferidoEm: "2026-11-15",
    },
    entrega,
    indisponivel: () => (lerChave() ? null : motivoSemChave(VARIAVEL_DA_CHAVE)),
    async abrir(config, linha, eventos, relogio) {
      const chave = lerChave();
      const socket = await abrirSocket("assemblyai", urlDaSessao(base, entrega(linha).taxaHz, config.vocabulario), { Authorization: chave ?? "" }, chave);
      let fechando = false;
      let custoUsd: number | null = null;
      socket.on("message", (dado, binario) => {
        let mensagem: z.infer<typeof Mensagem>;
        try {
          mensagem = lerMensagem("assemblyai", Mensagem, dado, binario);
        } catch (erro) {
          eventos.erro(erro as Error);
          return;
        }
        if ("error" in mensagem) {
          eventos.erro(erroDoServico("assemblyai", mensagem.error, chave));
          return;
        }
        if (mensagem.type === "Begin") {
          const modelo = mensagem.configuration?.model;
          if (modelo !== undefined && modelo !== MODELO) eventos.erro(erroDoServico("assemblyai", `o serviço aplicou o modelo "${modelo}", e não o pedido`, chave));
          return;
        }
        if (mensagem.type === "Termination") {
          custoUsd = (mensagem.session_duration_seconds / 3600) * USD_POR_HORA;
          return;
        }
        if (mensagem.end_of_turn) {
          if (mensagem.turn_is_formatted && mensagem.transcript.trim()) eventos.final(mensagem.transcript.trim(), relogio.agora());
          return;
        }
        const parcial = mensagem.transcript.trim() || (mensagem.words ?? []).map((w) => w.text).join(" ").trim();
        if (parcial) eventos.parcial(parcial, relogio.agora());
      });
      socket.on("close", (codigo) => {
        if (!fechando) eventos.erro(erroDoServico("assemblyai", `fechou a conexão no meio (código ${codigo})`, chave));
      });
      return {
        enviar: (pcm16) => {
          if (aberto(socket)) socket.send(pcm16);
        },
        async fechar() {
          fechando = true;
          if (aberto(socket)) socket.send(JSON.stringify({ type: "Terminate" }));
          await esperarFechamento(socket);
          return { custoUsd };
        },
      };
    },
  };
}

export default criarAssemblyAI();
