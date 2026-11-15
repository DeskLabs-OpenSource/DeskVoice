/**
 * O que os serviços externos de transcrição (Deepgram, AssemblyAI, Soniox) têm em comum: a conexão
 * WebSocket com a chave no cabeçalho, a leitura de toda resposta por zod, o fechamento com prazo e
 * a regra de que **o valor da chave nunca sai** em erro, log ou tabela.
 *
 * A chave vem de uma variável própria da bancada (`BANCADA_*_API_KEY`), entregue pelo cofre do
 * Paperclip. Sem ela, o serviço não roda, e a tabela diz "não medido: chave não entregue".
 *
 * O arquivo começa com "_": não é um serviço, e a descoberta da pasta o pula.
 */
import { ws, type RawData, type WebSocket, type z } from "../dependencias";

export const PRAZO_DE_ABERTURA_MS = 10_000;
export const PRAZO_DE_FECHAMENTO_MS = 10_000;

/** Como cada serviço externo é construído: o teste troca o endereço e a chave. */
export interface OpcoesDoExterno {
  /** Endereço do serviço. O teste aponta para o servidor falso. */
  url?: string;
  /** Lê a chave na hora de usar. Padrão: a variável da bancada. */
  chave?: () => string | undefined;
}

export function leitorDaChave(variavel: string, opcoes: OpcoesDoExterno): () => string | undefined {
  return opcoes.chave ?? (() => process.env[variavel] || undefined);
}

export function motivoSemChave(variavel: string): string {
  return `chave não entregue (${variavel})`;
}

/** Troca o valor da chave por "***" em qualquer texto que possa ir para a tela ou o resultado. */
export function semChave(texto: string, chave: string | undefined): string {
  return chave ? texto.split(chave).join("***") : texto;
}

/** Um erro com prefixo do serviço e sem a chave. */
export function erroDoServico(servico: string, texto: string, chave: string | undefined): Error {
  return new Error(semChave(`${servico}: ${texto}`, chave));
}

/** Abre a conexão. Rejeita com o motivo (sem a chave) se não abrir no prazo. */
export function abrirSocket(servico: string, url: string, cabecalhos: Record<string, string>, chave: string | undefined): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new ws.WebSocket(url, { headers: cabecalhos });
    const prazo = setTimeout(() => {
      socket.terminate();
      reject(erroDoServico(servico, `não abriu em ${PRAZO_DE_ABERTURA_MS} ms`, chave));
    }, PRAZO_DE_ABERTURA_MS);
    socket.once("open", () => {
      clearTimeout(prazo);
      resolve(socket);
    });
    socket.once("unexpected-response", (_pedido, resposta) => {
      clearTimeout(prazo);
      socket.terminate();
      reject(erroDoServico(servico, `recusou a conexão (HTTP ${resposta.statusCode ?? "?"})`, chave));
    });
    socket.once("error", (erro) => {
      clearTimeout(prazo);
      reject(erroDoServico(servico, `erro ao abrir (${erro.message})`, chave));
    });
  });
}

/** Resolve quando a conexão fecha, ou derruba a conexão quando o prazo vence. Nunca rejeita. */
export function esperarFechamento(socket: WebSocket, prazoMs = PRAZO_DE_FECHAMENTO_MS): Promise<void> {
  if (socket.readyState === ws.WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const prazo = setTimeout(() => {
      socket.terminate();
      resolve();
    }, prazoMs);
    socket.once("close", () => {
      clearTimeout(prazo);
      resolve();
    });
  });
}

/**
 * Lê uma mensagem de texto pelo esquema. Fora do esquema, lança com o caminho do campo, e nunca
 * com o conteúdo (que pode trazer o texto transcrito).
 */
export function lerMensagem<T>(servico: string, esquema: z.ZodType<T>, dado: RawData, binario: boolean): T {
  if (binario) throw new Error(`${servico}: mandou uma mensagem binária, que nenhum esquema prevê`);
  let json: unknown;
  try {
    json = JSON.parse(dado.toString());
  } catch {
    throw new Error(`${servico}: mandou uma mensagem que não é JSON`);
  }
  const lido = esquema.safeParse(json);
  if (!lido.success) throw new Error(`${servico}: resposta fora do esquema (${camposComProblema(lido.error.issues)})`);
  return lido.data;
}

interface Problema {
  path: PropertyKey[];
  code?: string;
  errors?: Problema[][];
}

/**
 * Os campos que falharam. Numa união, o zod só diz "nenhuma opção serviu" na raiz: aqui sai a
 * opção que chegou mais perto (a de menos problemas, a primeira no empate).
 */
export function camposComProblema(problemas: readonly Problema[], prefixo: PropertyKey[] = []): string {
  return problemas
    .map((p) => {
      const caminho = [...prefixo, ...p.path];
      if (p.code === "invalid_union" && p.errors && p.errors.length > 0) {
        const perto = p.errors.reduce((melhor, opcao) => (opcao.length < melhor.length ? opcao : melhor));
        return camposComProblema(perto, caminho);
      }
      return caminho.map(String).join(".") || "(raiz)";
    })
    .join(", ");
}

export function aberto(socket: WebSocket): boolean {
  return socket.readyState === ws.WebSocket.OPEN;
}
