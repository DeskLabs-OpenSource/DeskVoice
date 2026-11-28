// Sonda SIP: manda um OPTIONS por UDP e diz se veio resposta, qual código e de que endereço a
// central disse ter visto o pedido (o `received` do Via). É a régua do filtro de entrada por linha
// (R14): quem não é endereço de linha recebe a recusa, quem é passa.
//
// Aponte só para uma central sua. Mandar pedido SIP para servidor de outra pessoa é sondar a rede
// dela, e isso não é o uso desta ferramenta.
//
// Uso, de qualquer máquina que alcance a central sua:
//   pnpm exec tsx scripts/sonda-sip/sonda.ts <host> [--porta 5060] [--de-porta 0] [--usuario sonda] [--prazo 3000]
// Sai com 0 quando veio resposta (qualquer código) e com 1 quando não veio nada no prazo. A linha
// impressa é JSON: { answered, status, reason, received, rport, local }.
//
// A mesma porta também responde 200 ao OPTIONS que chegar (a qualificação que a central manda à
// linha): é o que deixa uma linha apontada para a sonda ficar "online".
import { randomBytes } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { isIPv6 } from "node:net";
import { pathToFileURL } from "node:url";

export interface ProbeAnswer {
  /** Veio resposta ao OPTIONS dentro do prazo. */
  answered: boolean;
  /** O código SIP da resposta (200, 401, 403...). */
  status?: number;
  reason?: string;
  /** O endereço de origem que a central viu, como ela o devolveu no Via (`received`). */
  received?: string;
  /** A porta de origem que a central viu (`rport`). */
  rport?: number;
  /** De onde a sonda mandou: endereço e porta locais. */
  local: { address: string; port: number };
  /** O Call-ID do pedido, para achar a linha dele no log da central. */
  callId?: string;
}

/** Um pedido que a central mandou para cá: a qualificação (OPTIONS, respondida com 200) ou um REGISTER. */
export interface SeenRequest {
  method: string;
  from: { address: string; port: number };
  /** O parâmetro `line` do Contact, quando há: o que a central usa para reconhecer a linha por registro. */
  line?: string;
}

const CRLF = "\r\n";
const token = (): string => randomBytes(8).toString("hex");
const hostPart = (address: string): string => (isIPv6(address) ? `[${address}]` : address);

/** A primeira linha e os cabeçalhos de uma mensagem SIP. Nomes em minúsculas; formas compactas (`v`, `i`) expandidas. */
export function parseSipMessage(text: string): { startLine: string; headers: Map<string, string[]> } {
  const [head = ""] = text.split(`${CRLF}${CRLF}`);
  const [startLine = "", ...lines] = head.split(CRLF);
  const compact: Record<string, string> = { v: "via", i: "call-id", f: "from", t: "to", m: "contact", l: "content-length" };
  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const raw = line.slice(0, colon).trim().toLowerCase();
    const name = compact[raw] ?? raw;
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return { startLine, headers };
}

/** O `received` e o `rport` do primeiro Via de uma resposta. */
export function viaSeen(via: string | undefined): { received?: string; rport?: number } {
  if (!via) return {};
  const received = /;\s*received=([^;,\s]+)/i.exec(via)?.[1];
  const rport = /;\s*rport=(\d+)/i.exec(via)?.[1];
  return { ...(received ? { received: received.replace(/^\[|\]$/g, "") } : {}), ...(rport ? { rport: Number(rport) } : {}) };
}

/** O endereço local que o sistema usaria para falar com `target` (sem mandar nada). */
async function localAddressFor(target: string, port: number): Promise<string> {
  const probe = createSocket(isIPv6(target) ? "udp6" : "udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.connect(port, target, () => resolve());
    });
    return probe.address().address;
  } finally {
    probe.close();
  }
}

export class SipProbe {
  readonly seen: SeenRequest[] = [];
  private readonly waiting = new Map<string, (message: string) => void>();

  private constructor(
    private readonly socket: Socket,
    readonly local: { address: string; port: number },
  ) {
    socket.on("message", (buffer, remote) => this.receive(buffer.toString("utf8"), remote));
  }

  /**
   * Abre a sonda numa porta (0: qualquer uma) e no endereço que o sistema usaria para falar com
   * `target`. É esse endereço que vai no Via e no Contact, e que a central deve ver como origem.
   */
  static async open(target: string, options: { port?: number; targetPort?: number } = {}): Promise<SipProbe> {
    const address = await localAddressFor(target, options.targetPort ?? 5060);
    const socket = createSocket(isIPv6(address) ? "udp6" : "udp4");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(options.port ?? 0, address, () => resolve());
    });
    return new SipProbe(socket, { address, port: socket.address().port });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.socket.close(() => resolve()));
  }

  /**
   * Manda um OPTIONS a `target:port`, apresentando-se como `user`, e espera a resposta final. Com
   * `line`, o pedido leva o parâmetro `line` do registro de uma linha, como a operadora o devolve.
   */
  async options(target: string, options: { port?: number; user?: string; line?: string; timeoutMs?: number } = {}): Promise<ProbeAnswer> {
    const port = options.port ?? 5060;
    const user = options.user ?? "sonda";
    const lineParam = options.line === undefined ? "" : `;line=${options.line}`;
    const callId = `${token()}@deskvoice-sonda`;
    const local = hostPart(this.local.address);
    // `rport` no Via: a central devolve `received` e `rport` com o que viu (RFC 3581), mesmo quando
    // o endereço é o mesmo que escrevemos aqui.
    const request = [
      `OPTIONS sip:${hostPart(target)}:${port}${lineParam} SIP/2.0`,
      `Via: SIP/2.0/UDP ${local}:${this.local.port};branch=z9hG4bK${token()};rport`,
      "Max-Forwards: 70",
      `From: <sip:${user}@${local}>;tag=${token()}`,
      `To: <sip:${hostPart(target)}:${port}${lineParam}>`,
      `Call-ID: ${callId}`,
      "CSeq: 1 OPTIONS",
      `Contact: <sip:${user}@${local}:${this.local.port}>`,
      "Accept: application/sdp",
      "User-Agent: DeskVoice sonda-sip",
      "Content-Length: 0",
      "",
      "",
    ].join(CRLF);
    const timeoutMs = options.timeoutMs ?? 3000;
    const answer = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(callId);
        clearInterval(resend);
        resolve(null);
      }, timeoutMs);
      // UDP perde pacote: o pedido sai de novo a cada 500 ms até a resposta ou o prazo.
      const send = (): void => void this.socket.send(request, port, target);
      const resend = setInterval(send, 500);
      this.waiting.set(callId, (message) => {
        clearTimeout(timer);
        clearInterval(resend);
        this.waiting.delete(callId);
        resolve(message);
      });
      send();
    });
    if (answer === null) return { answered: false, local: this.local, callId };
    const { startLine, headers } = parseSipMessage(answer);
    const [, status, reason] = /^SIP\/2\.0 (\d{3}) ?(.*)$/.exec(startLine) ?? [];
    return { answered: true, status: Number(status), reason: reason ?? "", ...viaSeen(headers.get("via")?.[0]), local: this.local, callId };
  }

  private receive(text: string, remote: { address: string; port: number }): void {
    const { startLine, headers } = parseSipMessage(text);
    const callId = headers.get("call-id")?.[0] ?? "";
    if (startLine.startsWith("SIP/2.0 ")) {
      // Resposta provisória (1xx) não encerra a espera.
      if (/^SIP\/2\.0 1\d\d/.test(startLine)) return;
      this.waiting.get(callId)?.(text);
      return;
    }
    const method = startLine.split(" ")[0] ?? "";
    const line = /;line=([^;>\s]+)/.exec(headers.get("contact")?.[0] ?? "")?.[1];
    this.seen.push({ method, from: { address: remote.address, port: remote.port }, ...(line === undefined ? {} : { line }) });
    if (method !== "OPTIONS") return;
    // Responde 200 com os cabeçalhos que identificam a transação, como o RFC 3261 pede.
    const copy = (name: string, label: string): string[] => (headers.get(name) ?? []).map((value) => `${label}: ${value}`);
    const response = [
      "SIP/2.0 200 OK",
      ...copy("via", "Via"),
      ...copy("from", "From"),
      ...(headers.get("to") ?? []).map((value) => `To: ${value}${value.includes(";tag=") ? "" : `;tag=${token()}`}`),
      ...copy("call-id", "Call-ID"),
      ...copy("cseq", "CSeq"),
      "Allow: OPTIONS",
      "Content-Length: 0",
      "",
      "",
    ].join(CRLF);
    this.socket.send(response, remote.port, remote.address);
  }
}

/** Lê os argumentos da linha de comando. */
function parseArgs(argv: string[]): { host: string; port: number; fromPort: number; user: string; timeoutMs: number } {
  const [host, ...rest] = argv;
  if (!host || host.startsWith("--")) throw new Error("usage: sonda.ts <host> [--porta 5060] [--de-porta 0] [--usuario sonda] [--prazo 3000] (point it only at a telephony server of yours)");
  const flag = (name: string, fallback: string): string => {
    const at = rest.indexOf(name);
    return at >= 0 && rest[at + 1] !== undefined ? (rest[at + 1] ?? fallback) : fallback;
  };
  return { host, port: Number(flag("--porta", "5060")), fromPort: Number(flag("--de-porta", "0")), user: flag("--usuario", "sonda"), timeoutMs: Number(flag("--prazo", "3000")) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const probe = await SipProbe.open(args.host, { port: args.fromPort, targetPort: args.port });
  try {
    const answer = await probe.options(args.host, { port: args.port, user: args.user, timeoutMs: args.timeoutMs });
    process.stdout.write(`${JSON.stringify(answer)}\n`);
    process.exitCode = answer.answered ? 0 : 1;
  } finally {
    await probe.close();
  }
}
