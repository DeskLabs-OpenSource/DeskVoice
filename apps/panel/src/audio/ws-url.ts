/** Onde o navegador conecta o áudio: no mesmo endereço do painel (o proxy encaminha) ou em outra porta. */
export type VoiceSocketTarget = { path: string } | { port: number };

const DEFAULT_PATH = "/voice-ws";

/**
 * Monta o endereço do áudio a partir do endereço em que a pessoa abriu o painel. Nada fixo: o
 * painel não sabe por qual domínio foi publicado. Página em `https` usa conexão cifrada, que é
 * também a única que o navegador aceita a partir de uma página segura.
 */
export function voiceSocketUrl(location: { protocol: string; host: string; hostname: string }, target: VoiceSocketTarget, token: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const address = "port" in target ? `${location.hostname}:${target.port}${DEFAULT_PATH}` : `${location.host}${target.path}`;
  return `${scheme}://${address}?token=${encodeURIComponent(token)}`;
}
