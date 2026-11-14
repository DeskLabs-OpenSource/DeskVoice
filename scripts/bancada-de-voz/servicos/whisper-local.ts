/**
 * Candidato aberto, na VPS: família Whisper em CPU, pelo faster-whisper (CTranslate2), sem chave e
 * sem mandar áudio para fora. Fluxo montado sobre um modelo que não é de fluxo: ver
 * `whisper_local.py`, que roda num venv à parte, fora do repositório e do produto.
 *
 * Fontes, conferidas em 14/11/2026:
 *   - https://github.com/SYSTRAN/faster-whisper  (licença MIT; `WhisperModel`, `initial_prompt`, VAD Silero embutido)
 *   - https://huggingface.co/Systran/faster-whisper-small  (pesos convertidos do openai/whisper-small, licença MIT)
 * Ambiente:
 *   BANCADA_PYTHON            python do venv com `faster-whisper`
 *   BANCADA_WHISPER_MODELO    tamanho do modelo (padrão `small`; `medium` mede o mais lento)
 *   BANCADA_WHISPER_FEIXE     feixe do texto final (padrão 5; o parcial usa 1)
 * Vocabulário: vai no `initial_prompt` ("Nomes e termos: ...").
 * Custo: sem preço por minuto. O custo é CPU da VPS, e a bancada não o converte em dinheiro.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { EventosDaSessao, ServicoMedido } from "./tipos";

const AJUDANTE = fileURLToPath(new URL("./whisper_local.py", import.meta.url));

let processo: ChildProcessWithoutNullStreams | null = null;
let ouvinte: ((mensagem: { tipo: string; id?: string; texto?: string; mensagem?: string }) => void) | null = null;
let contador = 0;

function escrever(objeto: unknown): void {
  processo?.stdin.write(`${JSON.stringify(objeto)}\n`);
}

const servico: ServicoMedido = {
  id: "whisper-local",
  rotulo: "Whisper em CPU na VPS (faster-whisper)",
  get modelo() {
    return `faster-whisper ${process.env.BANCADA_WHISPER_MODELO ?? "small"} int8, feixe final ${process.env.BANCADA_WHISPER_FEIXE ?? "5"}`;
  },
  preco: { usdPorMinuto: 0, fonte: "roda na VPS; o custo é CPU", conferidoEm: "2026-11-14" },
  // Whisper só ouve 16 kHz: a linha estreita chega subida de 8 para 16 kHz, com a banda do telefone.
  entrega: () => ({ taxaHz: 16000, mulaw: false }),
  indisponivel: () => (process.env.BANCADA_PYTHON ? null : "BANCADA_PYTHON não definido (venv com faster-whisper)"),

  async preparar() {
    const python = process.env.BANCADA_PYTHON ?? "";
    processo = spawn(python, [AJUDANTE], { stdio: ["pipe", "pipe", "pipe"] });
    processo.stderr.on("data", () => {}); // avisos do Hugging Face e do CTranslate2
    const linhas = createInterface({ input: processo.stdout });
    await new Promise<void>((resolve, reject) => {
      processo?.once("exit", (codigo) => reject(new Error(`whisper_local.py saiu com ${codigo}`)));
      linhas.on("line", (linha) => {
        const mensagem = JSON.parse(linha) as { tipo: string; id?: string; texto?: string; mensagem?: string };
        if (mensagem.tipo === "pronto") resolve();
        else if (mensagem.tipo === "erro") reject(new Error(mensagem.mensagem));
        else ouvinte?.(mensagem);
      });
    });
  },

  async encerrar() {
    processo?.stdin.end();
    processo = null;
  },

  async abrir(config, _linha, eventos: EventosDaSessao, relogio) {
    const id = `s${++contador}`;
    ouvinte = (m) => {
      if (m.id !== id) return;
      if (m.tipo === "parcial") eventos.parcial(m.texto ?? "", relogio.agora());
      else if (m.tipo === "final") eventos.final(m.texto ?? "", relogio.agora());
      else if (m.tipo === "erro") eventos.erro(new Error(m.mensagem));
    };
    escrever({ tipo: "inicio", id, idioma: config.idioma.split("-")[0], vocabulario: config.vocabulario });
    return {
      enviar: (pcm16) => escrever({ tipo: "audio", id, b64: pcm16.toString("base64") }),
      fechar: async () => {
        escrever({ tipo: "fim", id });
        ouvinte = null;
        return { custoUsd: 0 };
      },
    };
  },
};

export default servico;
