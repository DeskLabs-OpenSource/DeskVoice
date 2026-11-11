/** Onde o navegador conecta o áudio: um caminho no mesmo endereço do painel. */
export type VoiceSocketTarget = { path: string };

/**
 * Monta o endereço do áudio a partir do endereço em que a pessoa abriu o painel. Nada fixo: o
 * painel não sabe por qual domínio, porta ou túnel foi publicado, e a voz sai sempre pela mesma
 * origem. Página em `https` usa conexão cifrada, que é também a única que o navegador aceita a
 * partir de uma página segura.
 */
export function voiceSocketUrl(location: { protocol: string; host: string }, target: VoiceSocketTarget, token: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${target.path}?token=${encodeURIComponent(token)}`;
}
