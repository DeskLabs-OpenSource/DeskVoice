import { decryptSecret, encryptSecret, type OrgQuery } from "@deskvoice/core";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { Brain, BrainFailure, BrainModel } from "@deskvoice/voice-engine/brain";
import { z } from "zod";
import type { ServerDeps } from "./context";
import { createRateLimiter } from "./rate-limit";

// `loadBrains()` lê a pasta em tempo de execução, e dentro do pacote compilado do Next essa pasta não
// existe (o mesmo motivo de `pieces.ts`). A descoberta aqui é a mesma, por pasta e sem lista central,
// resolvida pelo empacotador: cérebro novo aparece sem editar este arquivo. Um teste confere que as
// duas descobertas acham os mesmos cérebros.
const brainModules = import.meta.glob<{ default: Brain }>(["../../../../packages/voice-engine/src/brains/*.ts", "!../../../../packages/voice-engine/src/brains/*.test.ts"]);

let brains: Promise<Brain[]> | undefined;

/** Os cérebros descobertos, em ordem de nome, para a tela não mudar de ordem entre versões. */
export function listBrains(): Promise<Brain[]> {
  return (brains ??= Promise.all(Object.values(brainModules).map(async (load) => (await load()).default)).then((all) =>
    all.toSorted((a, b) => a.label.localeCompare(b.label)),
  ));
}

export async function findBrain(id: string): Promise<Brain | undefined> {
  return (await listBrains()).find((brain) => brain.id === id);
}

/** A chave do cérebro, cifrada com `encryptSecret`. Separada da chave do motor do mesmo provedor. */
export const brainKeySetting = (brainId: string): string => `brain.${brainId}.api_key`;
/** O último teste da chave em vigor: o código, o status HTTP e quando. Sem segredo. */
export const brainKeyCheckSetting = (brainId: string): string => `brain.${brainId}.key_check`;
/** A lista de modelos que a chave em vigor alcança, como o provedor devolveu no último teste. */
export const brainModelsSetting = (brainId: string): string => `brain.${brainId}.models`;

const BRAIN_FAILURES = ["rejected", "no_credit", "region_unavailable", "rate_limited", "unreachable", "unexpected_response"] as const satisfies readonly BrainFailure[];
// Se `BrainFailure` ganhar um código, esta linha deixa de compilar até a lista (e a frase da tela) acompanhar.
type Missing = Exclude<BrainFailure, (typeof BRAIN_FAILURES)[number]>;
const everyFailureListed: Missing extends never ? true : false = true;
void everyFailureListed;

export const brainKeyCheck = z.object({
  result: z.enum(["accepted", ...BRAIN_FAILURES]),
  status: z.number().int().nullable(),
  checkedAt: z.string(),
});
export type BrainKeyCheck = z.infer<typeof brainKeyCheck>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cents = z.number().finite().nonnegative();
const brainModel = z.object({
  id: z.string().min(1).max(300),
  label: z.string().min(1).max(300),
  contextTokens: z.number().int().positive().optional(),
  price: z
    .object({
      centsPerMillionInputTokens: cents,
      centsPerMillionOutputTokens: cents,
      centsPerMillionCachedInputTokens: cents.optional(),
      source: z.string().min(1).max(500),
      checkedOn: z.string().regex(DAY),
    })
    .optional(),
}) satisfies z.ZodType<BrainModel>;

/** Validada na escrita e na leitura: um valor fora da forma no banco não chega à tela nem à análise. */
export const storedBrainModels = z.object({ fetchedAt: z.string(), models: z.array(brainModel).max(5000) });
export type StoredBrainModels = z.infer<typeof storedBrainModels>;

export const readBrainKeyCheck = (value: unknown): BrainKeyCheck | null => brainKeyCheck.safeParse(value).data ?? null;
export const readBrainModels = (value: unknown): StoredBrainModels | null => storedBrainModels.safeParse(value).data ?? null;

/** A lista mais velha que isto é relida quando a tela a pede. */
export const MODELS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Cinco leituras da lista por cérebro e organização a cada dez minutos, contando o teste ao salvar,
 * o botão "Atualizar lista" e a releitura da lista velha: o mesmo limite do teste da chave do motor.
 */
export const brainCheckLimiter = createRateLimiter(5, 10 * 60 * 1000);

type Org = <T>(run: (q: OrgQuery) => Promise<T>) => Promise<T>;

/**
 * Grava a chave nova cifrada e apaga o teste e a lista da anterior na mesma transação: a lista sempre
 * fala da chave em vigor. Devolve o valor cifrado, para o teste conferir depois que ele não mudou.
 */
export async function saveBrainKey(q: OrgQuery, deps: ServerDeps, brain: Brain, apiKey: string): Promise<string> {
  const stored = encryptSecret(apiKey, deps.secretKey);
  await q.exec("delete from settings where key = any($1)", [[brainKeyCheckSetting(brain.id), brainModelsSetting(brain.id)]]);
  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, true, $4)
     on conflict (organization_id, key) do update set value = excluded.value, secret = true, updated_at = excluded.updated_at`,
    [q.organizationId, brainKeySetting(brain.id), JSON.stringify(stored), deps.clock.now()],
  );
  return stored;
}

/** Remove a chave, o teste e a lista juntos. `false` quando não havia chave. */
export async function removeBrainKey(q: OrgQuery, brain: Brain): Promise<boolean> {
  const removed = await q.many<{ key: string }>("delete from settings where key = any($1) returning key", [
    [brainKeySetting(brain.id), brainKeyCheckSetting(brain.id), brainModelsSetting(brain.id)],
  ]);
  return removed.some((row) => row.key === brainKeySetting(brain.id));
}

/** A chave salva, cifrada, ou `null`. Nunca vai em resposta. */
export async function storedBrainKey(q: OrgQuery, brain: Brain): Promise<string | null> {
  const row = await q.one<{ value: unknown }>("select value from settings where key = $1", [brainKeySetting(brain.id)]);
  return typeof row?.value === "string" ? row.value : null;
}

export async function readStoredModels(q: OrgQuery, brain: Brain): Promise<StoredBrainModels | null> {
  const row = await q.one<{ value: unknown }>("select value from settings where key = $1", [brainModelsSetting(brain.id)]);
  return row ? readBrainModels(row.value) : null;
}

export interface BrainTest {
  check: BrainKeyCheck;
  /** A lista lida, quando a chave foi aceita. */
  models: StoredBrainModels | null;
  /** `false` quando a chave mudou durante o teste: nada foi gravado, e o resultado não fala da chave em vigor. */
  saved: boolean;
}

/**
 * Lê a lista de modelos com a chave gravada (`stored`, cifrada), que é o teste da chave, e guarda o
 * resultado. `null` quando o limite foi atingido: nada é pedido ao provedor. Roda fora de transação:
 * a leitura leva até 10 s.
 */
export async function testBrainKey(deps: ServerDeps, org: Org, organizationId: string, brain: Brain, stored: string): Promise<BrainTest | null> {
  if (!brainCheckLimiter.take(`${organizationId}:${brain.id}`, deps.clock.now())) return null;
  const now = deps.clock.now();
  const result = await brain.listModels(decryptSecret(stored, deps.secretKey), { fetch: deps.fetch, today: now.toISOString().slice(0, 10) });
  const checkedAt = now.toISOString();
  const check: BrainKeyCheck = result.ok ? { result: "accepted", status: 200, checkedAt } : { result: result.failure, status: result.status, checkedAt };
  // Item fora da forma descartado aqui também: a peça já filtra, e o banco só recebe o que a leitura aceita.
  const models = result.ok ? storedBrainModels.parse({ fetchedAt: checkedAt, models: result.models.flatMap((model) => brainModel.safeParse(model).data ?? []) }) : null;
  const saved = await org(async (q) => {
    // Só grava se a chave testada ainda é a que está salva, e trava a linha até o fim: uma troca durante
    // o teste não herda o resultado, nem a lista de outra chave.
    const same = await q.one("select 1 from settings where key = $1 and value = $2::jsonb for update", [brainKeySetting(brain.id), JSON.stringify(stored)]);
    if (!same) return false;
    const write = (key: string, value: unknown) =>
      q.exec(
        `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)
         on conflict (organization_id, key) do update set value = excluded.value, secret = false, updated_at = excluded.updated_at`,
        [q.organizationId, key, JSON.stringify(value), now],
      );
    await write(brainKeyCheckSetting(brain.id), check);
    // Falha não apaga a lista guardada: ela continua sendo da mesma chave, e a tela a mostra como velha.
    if (models) await write(brainModelsSetting(brain.id), models);
    return true;
  });
  return { check, models, saved };
}

export const isStale = (models: StoredBrainModels, now: Date): boolean => now.getTime() - new Date(models.fetchedAt).getTime() > MODELS_MAX_AGE_MS;
