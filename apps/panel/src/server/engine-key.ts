import { decryptSecret, type OrgQuery } from "@deskvoice/core";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import { KEY_CHECK_RESULTS, type VoiceEngine } from "@deskvoice/voice-engine/types";
import { z } from "zod";
import type { ServerDeps } from "./context";
import type { EngineKeys } from "./health";
import { engineKeySetting, listEngines } from "./pieces";
import { createRateLimiter } from "./rate-limit";

/**
 * O último teste da chave de um motor, guardado ao lado dela em `settings` (sem segredo: só o
 * código, o modelo e quando). Some quando a chave é trocada ou removida, então sempre fala da
 * chave em vigor. A saúde lê daqui e nunca testa por conta própria: seria uma chamada ao provedor
 * por aba aberta por minuto.
 */
export const keyCheckSetting = (engineId: string): string => `engine.${engineId}.key_check`;

export const storedKeyCheck = z.object({ result: z.enum(KEY_CHECK_RESULTS), model: z.string().optional(), checkedAt: z.string() });
export type KeyCheckView = z.infer<typeof storedKeyCheck>;

export const readKeyCheck = (value: unknown): KeyCheckView | null => storedKeyCheck.safeParse(value).data ?? null;

/**
 * Cinco testes por motor e organização a cada dez minutos: o bastante para colar, errar e colar
 * de novo, e pouco para o botão virar um jeito de martelar o provedor com a chave de alguém.
 */
export const keyCheckLimiter = createRateLimiter(5, 10 * 60 * 1000);

type Org = <T>(run: (q: OrgQuery) => Promise<T>) => Promise<T>;

/**
 * Testa a chave gravada (`stored`, cifrada) e guarda o resultado. `null` quando o limite de testes
 * foi atingido: nada é pedido ao provedor. Roda fora de transação: a chamada leva até 10 s.
 */
export async function testEngineKey(deps: ServerDeps, org: Org, organizationId: string, engine: VoiceEngine, stored: string): Promise<KeyCheckView | null> {
  if (!keyCheckLimiter.take(`${organizationId}:${engine.id}`, deps.clock.now())) return null;
  const check = await engine.checkKey(decryptSecret(stored, deps.secretKey), { fetch: deps.fetch });
  const view: KeyCheckView = { ...check, checkedAt: deps.clock.now().toISOString() };
  // Só grava se a chave testada ainda é a que está salva: uma troca durante o teste não herda o resultado.
  await org((q) =>
    q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at)
       select $1, $2, $3, false, $4 where exists (select 1 from settings where key = $5 and value = $6::jsonb)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, keyCheckSetting(engine.id), JSON.stringify(view), deps.clock.now(), engineKeySetting(engine.id), JSON.stringify(stored)],
    ),
  );
  return view;
}

/**
 * As chaves de motor da transação e o último teste de cada uma, para a linha do motor da saúde
 * (`engineLine`) e a coluna Motor da visão geral da instalação: a mesma leitura nas duas. Só o
 * código do último teste: a chave mesma nunca sai do banco por aqui.
 */
export async function readEngineKeys(q: OrgQuery): Promise<EngineKeys> {
  const labels = new Map((await listEngines()).map((engine) => [keyCheckSetting(engine.id), engine.label]));
  const rows = await q.many<{ key: string; value: unknown }>(
    "select key, case when secret then null else value end as value from settings where key like 'engine.%.api_key' or key like 'engine.%.key_check'",
  );
  return {
    keys: rows.filter((row) => row.key.endsWith(".api_key")).length,
    checks: rows.flatMap((row) => {
      const check = readKeyCheck(row.value);
      return check ? [{ engine: labels.get(row.key) ?? row.key, check }] : [];
    }),
  };
}
