import { z } from "zod";
import project from "../../../../package.json";
import type { ServerDeps } from "./context";

// O endereço do repositório tem uma fonte: o campo `repository` do package.json da raiz.
const REPOSITORY = project.repository.replace(/^github:/, "");
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;
const TIMEOUT_MS = 5000;
// Curto de propósito: a tela não pode anunciar por horas uma versão que mudou. A falha dura menos
// ainda, para a consulta voltar logo; o limite público do GitHub (60 por hora) fica longe.
const FRESH_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;

const releaseSchema = z.array(
  z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean(), body: z.string().nullish(), published_at: z.string().nullish(), html_url: z.string() }),
);

export interface NoteItem {
  title: string;
  text: string;
}
export interface PublishedRelease {
  version: string;
  publishedAt: string | null;
  url: string;
  /** Os itens do bloco "Requer atenção" da nota: o que o operador precisa fazer. */
  attention: NoteItem[];
  sections: Array<{ heading: string; items: NoteItem[] }>;
}
/** `ok: false` = não deu para consultar agora. Nunca vira "você está na mais recente". */
export type Published = { ok: true; latest: string | null; newer: PublishedRelease[] } | { ok: false };

const FINAL_VERSION = /^\d+\.\d+\.\d+$/;
/** Versão publicada final (X.Y.Z). `local`, `dev` e pré-versão não entram: a tela não atualiza a partir delas. */
export const isPublishedVersion = (version: string): boolean => FINAL_VERSION.test(version);

export function compareVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((left?.[i] ?? 0) !== (right?.[i] ?? 0)) return (left?.[i] ?? 0) - (right?.[i] ?? 0);
  return 0;
}

const ATTENTION = /^requer atenção$/i;

/** A nota da versão é a seção do CHANGELOG: títulos `###` e itens `- **título** texto`. */
export function parseNotes(body: string): Pick<PublishedRelease, "attention" | "sections"> {
  const sections: PublishedRelease["sections"] = [];
  for (const line of body.split("\n")) {
    const heading = /^#{2,4}\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({ heading: (heading[1] ?? "").trim(), items: [] });
      continue;
    }
    if (!line.trim()) continue;
    if (sections.length === 0) sections.push({ heading: "", items: [] });
    const items = sections[sections.length - 1]?.items ?? [];
    const item = /^- (?:\*\*(.+?)\*\*\s*)?(.*)$/.exec(line);
    const last = items[items.length - 1];
    if (item) items.push({ title: item[1] ?? "", text: item[2] ?? "" });
    else if (last) last.text = `${last.text} ${line.trim()}`.trim();
    else items.push({ title: "", text: line.trim() });
  }
  return {
    attention: sections.filter((section) => ATTENTION.test(section.heading)).flatMap((section) => section.items),
    sections: sections.filter((section) => !ATTENTION.test(section.heading) && section.items.length > 0),
  };
}

let cache: { at: number; running: string; value: Published } | undefined;

/** Só para testes. */
export function clearReleaseCache(): void {
  cache = undefined;
}

/**
 * As versões publicadas, lidas da API pública de releases do GitHub: sem credencial e sem dizer
 * nada sobre esta instalação (a consulta é a mesma para todo mundo). `newer` traz as versões
 * acima da que está em execução, da mais nova para a mais antiga.
 */
export async function publishedReleases(deps: ServerDeps): Promise<Published> {
  const now = deps.clock.now().getTime();
  if (cache && cache.running === deps.appVersion && now - cache.at < (cache.value.ok ? FRESH_MS : RETRY_MS)) return cache.value;
  let value: Published;
  try {
    const response = await deps.fetch(RELEASES_URL, { headers: { accept: "application/vnd.github+json", "user-agent": "deskvoice-panel" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = releaseSchema
      .parse(await response.json())
      .filter((release) => !release.draft && !release.prerelease && isPublishedVersion(release.tag_name.replace(/^v/, "")))
      .map((release) => ({ version: release.tag_name.replace(/^v/, ""), publishedAt: release.published_at ?? null, url: release.html_url, ...parseNotes(release.body ?? "") }))
      .sort((a, b) => compareVersions(b.version, a.version));
    const running = deps.appVersion;
    value = { ok: true, latest: releases[0]?.version ?? null, newer: isPublishedVersion(running) ? releases.filter((release) => compareVersions(release.version, running) > 0) : [] };
  } catch (error) {
    process.stderr.write(`[panel] could not read published releases: ${error instanceof Error ? error.message : String(error)}\n`);
    value = { ok: false };
  }
  cache = { at: now, running: deps.appVersion, value };
  return value;
}
