/**
 * Soniox em tempo real, falando direto com o serviço (sem SDK).
 *
 * Fontes, conferidas em 15/11/2026:
 * - idiomas: docs.soniox.com/stt/concepts/supported-languages. "Portuguese", código `pt`, e "all
 *   languages are available" na API de tempo real;
 * - protocolo: docs.soniox.com/api-reference/stt/websocket-api
 *   (`wss://stt-rt.soniox.com/transcribe-websocket`; a configuração vai numa mensagem de texto
 *   antes do áudio; a resposta traz `tokens` com `text` e `is_final`; um quadro de texto vazio
 *   fecha, e o serviço responde `finished: true`). A chave vai no cabeçalho
 *   `Authorization: Bearer`: o campo `api_key` da configuração está obsoleto;
 * - fim de trecho: docs.soniox.com/stt/rt/endpoint-detection. Com `enable_endpoint_detection`, um
 *   token final `<end>` fecha o trecho;
 * - vocabulário: `context.terms`;
 * - modelo: `stt-rt-v6`, o de tempo real da página;
 * - preço: soniox.com/pricing. US$ 0,12 por hora em tempo real. A página não diz se cobra o áudio
 *   ou a sessão, e por isso o teto conta o dobro por minuto de áudio. O serviço não declara o custo
 *   na sessão, e a bancada estima pela duração do áudio.
 *
 * Chave: `BANCADA_SONIOX_API_KEY`.
 *
 * Os tokens são pedaços de palavra, com o espaço junto. O final só sai no `<end>` (ou no fim da
 * sessão), com o trecho inteiro, para a bancada não partir uma palavra entre dois finais.
 */
import { z } from "../dependencias";
import type { Linha } from "../linhas";
import { abrirSocket, aberto, erroDoServico, esperarFechamento, leitorDaChave, lerMensagem, motivoSemChave, type OpcoesDoExterno } from "./_externo";
import type { ServicoMedido } from "./tipos";

export const VARIAVEL_DA_CHAVE = "BANCADA_SONIOX_API_KEY";
const URL_PADRAO = "wss://stt-rt.soniox.com/transcribe-websocket";
const MODELO = "stt-rt-v6";
const USD_POR_HORA = 0.12;
const FIM_DE_TRECHO = "<end>";

const Mensagem = z.union([
  z.object({
    tokens: z.array(z.object({ text: z.string(), is_final: z.boolean() })),
    finished: z.boolean().optional(),
  }),
  z.object({ error_code: z.number(), error_message: z.string(), error_type: z.string().optional() }),
]);

/** A configuração da sessão, mandada antes do áudio. A chave não vai aqui: vai no cabeçalho. */
export function configuracaoDaSessao(idioma: string, taxaHz: number, vocabulario: readonly string[]): Record<string, unknown> {
  return {
    model: MODELO,
    audio_format: "pcm_s16le",
    sample_rate: taxaHz,
    num_channels: 1,
    language_hints: [idioma.split("-")[0]?.toLowerCase() ?? idioma],
    enable_endpoint_detection: true,
    ...(vocabulario.length > 0 ? { context: { terms: [...vocabulario] } } : {}),
  };
}

export function criarSoniox(opcoes: OpcoesDoExterno = {}): ServicoMedido {
  const lerChave = leitorDaChave(VARIAVEL_DA_CHAVE, opcoes);
  const base = opcoes.url ?? URL_PADRAO;
  const entrega = (linha: Linha) => (linha === "estreita" ? { taxaHz: 8000 as const, mulaw: false } : { taxaHz: 16000 as const, mulaw: false });
  return {
    id: "soniox",
    rotulo: "Soniox (tempo real)",
    modelo: MODELO,
    preco: {
      usdPorMinuto: USD_POR_HORA / 60,
      tetoUsdPorMinuto: (2 * USD_POR_HORA) / 60,
      fonte: "soniox.com/pricing (US$ 0,12 por hora em tempo real)",
      conferidoEm: "2026-11-15",
    },
    entrega,
    indisponivel: () => (lerChave() ? null : motivoSemChave(VARIAVEL_DA_CHAVE)),
    async abrir(config, linha, eventos, relogio) {
      const chave = lerChave();
      const socket = await abrirSocket("soniox", base, { Authorization: `Bearer ${chave ?? ""}` }, chave);
      socket.send(JSON.stringify(configuracaoDaSessao(config.idioma, entrega(linha).taxaHz, config.vocabulario)));
      let fechando = false;
      let trecho = "";
      const fecharTrecho = (): void => {
        const texto = trecho.trim();
        trecho = "";
        if (texto) eventos.final(texto, relogio.agora());
      };
      socket.on("message", (dado, binario) => {
        let mensagem: z.infer<typeof Mensagem>;
        try {
          mensagem = lerMensagem("soniox", Mensagem, dado, binario);
        } catch (erro) {
          eventos.erro(erro as Error);
          return;
        }
        if ("error_code" in mensagem) {
          eventos.erro(erroDoServico("soniox", `${mensagem.error_type ?? mensagem.error_code}: ${mensagem.error_message}`, chave));
          return;
        }
        let provisorio = "";
        for (const token of mensagem.tokens) {
          if (token.text === FIM_DE_TRECHO) {
            if (token.is_final) fecharTrecho();
          } else if (token.is_final) trecho += token.text;
          else provisorio += token.text;
        }
        const parcial = `${trecho}${provisorio}`.trim();
        if (parcial) eventos.parcial(parcial, relogio.agora());
        if (mensagem.finished) fecharTrecho();
      });
      socket.on("close", (codigo) => {
        if (!fechando) eventos.erro(erroDoServico("soniox", `fechou a conexão no meio (código ${codigo})`, chave));
      });
      return {
        enviar: (pcm16) => {
          if (aberto(socket)) socket.send(pcm16);
        },
        async fechar() {
          fechando = true;
          if (aberto(socket)) socket.send("");
          await esperarFechamento(socket);
          fecharTrecho();
          return { custoUsd: null };
        },
      };
    },
  };
}

export default criarSoniox();
