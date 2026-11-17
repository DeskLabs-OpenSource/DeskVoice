import { decryptSecret, encryptSecret, recordOrgEvent, type OrgQuery } from "@deskvoice/core";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { SpeechSynthesizer, SynthesizerVoice } from "@deskvoice/voice-engine/types";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "./context";
import { readKeyCheck, storedKeyCheck, type KeyCheckView } from "./engine-key";
import { createRateLimiter } from "./rate-limit";

/**
 * A voz do pipeline na tela (desenho R5, fatia 1b): a chave da voz, cifrada, a confirmação nomeando o
 * fornecedor e a lista de vozes. `loadSynthesizers()` lê a pasta em tempo de execução, e no pacote do
 * Next ela não existe (o mesmo motivo de `pieces.ts` e `brains.ts`): a descoberta é a mesma, por
 * pasta, resolvida pelo empacotador. Um teste confere que as duas acham as mesmas vozes.
 */
const synthesizerModules = import.meta.glob<{ default: SpeechSynthesizer }>([
  "../../../../packages/voice-engine/src/synthesizers/*.ts",
  "!../../../../packages/voice-engine/src/synthesizers/*.test.ts",
]);

let synthesizers: Promise<SpeechSynthesizer[]> | undefined;

/** Todas as vozes da pasta, em ordem de nome. */
export function listAllSynthesizers(): Promise<SpeechSynthesizer[]> {
  return (synthesizers ??= Promise.all(Object.values(synthesizerModules).map(async (load) => (await load()).default)).then((all) =>
    all.toSorted((a, b) => a.label.localeCompare(b.label)),
  ));
}

/**
 * As vozes que a tela oferece: as que pedem chave. A simulada fica de fora: ela não tem chave nem
 * fornecedor, e serve à bancada e à chamada simulada.
 */
export async function listOfferedSynthesizers(): Promise<SpeechSynthesizer[]> {
  return (await listAllSynthesizers()).filter((synthesizer) => synthesizer.keyless !== true);
}

export async function offeredSynthesizer(id: string): Promise<SpeechSynthesizer> {
  const synthesizer = (await listOfferedSynthesizers()).find((candidate) => candidate.id === id);
  if (!synthesizer) throw new ApiError(404, "not_found", "Not found.");
  return synthesizer;
}

/** A chave da voz, cifrada com `encryptSecret`. Separada da chave do motor e do cérebro. */
export const synthesizerKeySetting = (id: string): string => `synthesizer.${id}.api_key`;
/** O último teste da chave em vigor: o código e quando. Sem segredo. */
export const synthesizerKeyCheckSetting = (id: string): string => `synthesizer.${id}.key_check`;
/**
 * A confirmação nomeando o fornecedor da chave em vigor (seção 9.1 do desenho): quem e quando. Sai
 * junto com a chave; o recibo `synthesizer_provider_confirmed` fica no Registro da privacidade.
 */
export const synthesizerConsentSetting = (id: string): string => `synthesizer.${id}.consent`;

const storedConsent = z.object({ userId: z.string(), confirmedAt: z.string() });
export type Consent = z.infer<typeof storedConsent>;
export const readConsent = (value: unknown): Consent | null => storedConsent.safeParse(value).data ?? null;

export interface SynthesizerView {
  id: string;
  label: string;
  provider: string;
  processingLocation: SpeechSynthesizer["processingLocation"];
  keyUrl: string | null;
  /** Da chave, só se existe. Nunca o valor. */
  configured: boolean;
  keyCheck: KeyCheckView | null;
  /** Quem confirmou a chave em vigor e quando. `name` nulo: a pessoa saiu da equipe. */
  consent: { name: string | null; at: string } | null;
}

export async function readSynthesizers(q: OrgQuery): Promise<SynthesizerView[]> {
  // O valor de segredo nunca sai do banco por aqui: só o nome da chave.
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'synthesizer.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const views: SynthesizerView[] = [];
  for (const synthesizer of await listOfferedSynthesizers()) {
    const configured = byKey.has(synthesizerKeySetting(synthesizer.id));
    const consent = configured ? readConsent(byKey.get(synthesizerConsentSetting(synthesizer.id))) : null;
    const name = consent ? ((await q.one<{ name: string }>("select u.name from users u where u.id::text = $1", [consent.userId]))?.name ?? null) : null;
    views.push({
      id: synthesizer.id,
      label: synthesizer.label,
      provider: synthesizer.provider,
      processingLocation: synthesizer.processingLocation,
      keyUrl: synthesizer.keyUrl ?? null,
      configured,
      keyCheck: configured ? readKeyCheck(byKey.get(synthesizerKeyCheckSetting(synthesizer.id))) : null,
      consent: consent ? { name, at: consent.confirmedAt } : null,
    });
  }
  return views;
}

export const synthesizerKeyInput = z.object({
  apiKey: z.string().trim().min(1).max(500),
  /** O fornecedor que a pessoa leu na confirmação ("O texto que o agente fala na ligação vai para a ElevenLabs"). */
  confirmedProvider: z.string().trim().min(1).max(80).optional(),
});

async function upsert(q: OrgQuery, key: string, value: unknown, secret: boolean, now: Date): Promise<void> {
  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, $4, $5)
     on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
    [q.organizationId, key, JSON.stringify(value), secret, now],
  );
}

/** A chave salva, cifrada, ou `null`. Nunca vai em resposta. */
export async function storedSynthesizerKey(q: OrgQuery, synthesizer: SpeechSynthesizer): Promise<string | null> {
  const row = await q.one<{ value: unknown }>("select value from settings where key = $1", [synthesizerKeySetting(synthesizer.id)]);
  return typeof row?.value === "string" ? row.value : null;
}

/**
 * Grava a chave da voz. Uma chave nova (ou a primeira) pede `confirmedProvider` igual ao fornecedor
 * da voz: sem ela, 422 e nada é gravado. Com ela, a chave, a confirmação e o recibo saem na mesma
 * transação. A mesma chave de novo, já confirmada, não pede confirmação nem grava outro recibo: só é
 * testada de novo. Devolve o valor cifrado em vigor, para o teste.
 */
export async function saveSynthesizerKey(q: OrgQuery, deps: ServerDeps, session: Session, synthesizer: SpeechSynthesizer, body: z.output<typeof synthesizerKeyInput>): Promise<string> {
  const current = await storedSynthesizerKey(q, synthesizer);
  const consent = readConsent((await q.one<{ value: unknown }>("select value from settings where key = $1", [synthesizerConsentSetting(synthesizer.id)]))?.value);
  if (current !== null && consent !== null && decryptSecret(current, deps.secretKey) === body.apiKey) return current;
  if (body.confirmedProvider !== synthesizer.provider) {
    throw new ApiError(
      422,
      body.confirmedProvider === undefined ? "provider_confirmation_required" : "provider_confirmation_invalid",
      `${synthesizer.label} receives the text the agent speaks on the call, outside this server. Confirm it with confirmedProvider: "${synthesizer.provider}".`,
    );
  }
  const now = deps.clock.now();
  const stored = encryptSecret(body.apiKey, deps.secretKey);
  await q.exec("delete from settings where key = $1", [synthesizerKeyCheckSetting(synthesizer.id)]);
  await upsert(q, synthesizerKeySetting(synthesizer.id), stored, true, now);
  await upsert(q, synthesizerConsentSetting(synthesizer.id), { userId: session.userId, confirmedAt: now.toISOString() } satisfies Consent, false, now);
  // O recibo, só de acréscimo e com o nome do momento (sem e-mail): a `settings` acima diz se a chave
  // de hoje está confirmada e sai com ela; o recibo fica, mesmo depois de a pessoa sair da equipe.
  await recordOrgEvent(q, "synthesizer_provider_confirmed", { synthesizerId: synthesizer.id, provider: synthesizer.provider, confirmedByName: session.name }, now, session.userId);
  return stored;
}

/** Remove a chave, o último teste e a confirmação. O recibo fica. `false` quando não havia chave. */
export async function removeSynthesizerKey(q: OrgQuery, synthesizer: SpeechSynthesizer): Promise<boolean> {
  const removed = await q.many<{ key: string }>("delete from settings where key = any($1) returning key", [
    [synthesizerKeySetting(synthesizer.id), synthesizerKeyCheckSetting(synthesizer.id), synthesizerConsentSetting(synthesizer.id)],
  ]);
  return removed.some((row) => row.key === synthesizerKeySetting(synthesizer.id));
}

/**
 * Cinco testes por voz e organização a cada dez minutos, o mesmo limite da chave do motor: o bastante
 * para colar, errar e colar de novo, e pouco para o botão martelar o fornecedor com a chave de alguém.
 */
export const synthesizerKeyCheckLimiter = createRateLimiter(5, 10 * 60 * 1000);
/** Vinte leituras da lista de vozes por voz e organização a cada dez minutos: abrir a seção relê a lista. */
export const synthesizerVoicesLimiter = createRateLimiter(20, 10 * 60 * 1000);

type Org = <T>(run: (q: OrgQuery) => Promise<T>) => Promise<T>;

/**
 * Testa a chave gravada (`stored`, cifrada) pelo `checkKey` da voz e guarda o resultado, só se a chave
 * testada ainda é a salva. `null` quando o limite adiou o teste: nada sai para o fornecedor. Roda fora
 * de transação. O resultado é o vocabulário fechado; nunca a chave nem o texto do fornecedor.
 */
export async function testSynthesizerKey(deps: ServerDeps, org: Org, organizationId: string, synthesizer: SpeechSynthesizer, stored: string): Promise<KeyCheckView | null> {
  if (!synthesizerKeyCheckLimiter.take(`${organizationId}:${synthesizer.id}`, deps.clock.now())) return null;
  const check = await synthesizer.checkKey(decryptSecret(stored, deps.secretKey), { fetch: deps.fetch });
  const view = storedKeyCheck.parse({ ...check, checkedAt: deps.clock.now().toISOString() });
  await org((q) =>
    q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at)
       select $1, $2, $3, false, $4 where exists (select 1 from settings where key = $5 and value = $6::jsonb)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, synthesizerKeyCheckSetting(synthesizer.id), JSON.stringify(view), deps.clock.now(), synthesizerKeySetting(synthesizer.id), JSON.stringify(stored)],
    ),
  );
  return view;
}

/** O lugar de uma voz na lista: português do Brasil primeiro, depois outro português, depois o resto. */
const rankOf = (voice: SynthesizerVoice): number => {
  const languages = voice.languages.map((language) => language.toLowerCase().replace("_", "-"));
  if (languages.includes("pt-br")) return 0;
  if (languages.some((language) => language === "pt" || language.startsWith("pt-"))) return 1;
  return 2;
};

/** pt-BR primeiro; dentro de cada grupo, a ordem de nome. */
export const sortVoices = (voices: readonly SynthesizerVoice[]): SynthesizerVoice[] =>
  voices.toSorted((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
