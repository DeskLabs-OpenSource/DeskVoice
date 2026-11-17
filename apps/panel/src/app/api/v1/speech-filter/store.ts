import { decryptSecret, encryptSecret, recordOrgEvent, type OrgQuery } from "@deskvoice/core";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import { DECISION_MODEL_SETTING, decisionModelKeySetting, decisionModelOf, type DecisionModel, type ProcessingLocation } from "@deskvoice/voice-engine/types";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "../../../../server/context";
import { readKeyCheck, storedKeyCheck, type KeyCheckView } from "../../../../server/engine-key";
import { listDecisionModels } from "../../../../server/pieces";
import { createRateLimiter } from "../../../../server/rate-limit";

/**
 * O filtro da fala na tela (desenho R12, fatia 7b). A escolha mora em `calls.decision_model`, que a
 * voz já lê desde a fatia 6; a chave do modelo, cifrada, em `decision_model.<id>.api_key`. Estas
 * chaves não passam pela rota genérica de `settings` (ela não as conhece): ligar o filtro pede a
 * confirmação nomeando o fornecedor, e isso só existe aqui.
 */

/** Quem confirmou o envio ao fornecedor, e quando. Guarda o nome do momento: a pessoa pode sair da equipe. */
export const DECISION_MODEL_CONFIRMATION_SETTING = "calls.decision_model_confirmation";
/** O último teste da chave em vigor do modelo: o código, o modelo conferido e quando. Sem segredo. */
export const decisionModelKeyCheckSetting = (modelId: string): string => `decision_model.${modelId}.key_check`;

const storedConfirmation = z.object({ model: z.string(), provider: z.string(), userId: z.string(), name: z.string(), at: z.string() });
export type Confirmation = z.infer<typeof storedConfirmation>;

/**
 * Os modelos que a tela oferece. O simulado fica de fora: ele responde o neutro sem ler nada, serve a
 * teste e à chamada simulada (que o usa sozinha), e numa ligação real seria um filtro de mentira.
 */
export async function offeredModels(): Promise<DecisionModel[]> {
  return (await listDecisionModels()).filter((model) => model.id !== "simulated").toSorted((a, b) => a.label.localeCompare(b.label));
}

async function offeredModel(id: string): Promise<DecisionModel> {
  const model = (await offeredModels()).find((candidate) => candidate.id === id);
  if (!model) throw new ApiError(400, "unknown_decision_model", `"${id}" is not a decision model of this installation.`);
  return model;
}

/** O texto da ligação sai deste servidor com este modelo: ligar pede a confirmação nomeando o fornecedor. */
const processesElsewhere = (location: ProcessingLocation): boolean => location.kind !== "this-server";

export interface ModelView {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  keyless: boolean;
  /** Da chave, só se existe. Nunca o valor. */
  key: { configured: boolean };
  keyCheck: KeyCheckView | null;
}

export interface SpeechFilterView {
  /** O modelo ligado, ou `null` (desligado, o de fábrica). */
  model: string | null;
  confirmation: { provider: string; name: string; at: string } | null;
  models: ModelView[];
}

export async function readSpeechFilter(q: OrgQuery): Promise<SpeechFilterView> {
  // O valor de segredo nunca sai do banco por aqui: só o nome da chave.
  const rows = await q.many<{ key: string; value: unknown }>(
    "select key, case when secret then null else value end as value from settings where key = $1 or key = $2 or key like 'decision\\_model.%'",
    [DECISION_MODEL_SETTING, DECISION_MODEL_CONFIRMATION_SETTING],
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const model = decisionModelOf(byKey.get(DECISION_MODEL_SETTING)) ?? null;
  const confirmation = storedConfirmation.safeParse(byKey.get(DECISION_MODEL_CONFIRMATION_SETTING)).data;
  return {
    model,
    // A confirmação só vale para o modelo ligado: a de outro modelo não aparece como se fosse deste.
    confirmation: confirmation && confirmation.model === model ? { provider: confirmation.provider, name: confirmation.name, at: confirmation.at } : null,
    models: (await offeredModels()).map((each) => ({
      id: each.id,
      label: each.label,
      provider: each.provider,
      processingLocation: each.processingLocation,
      keyless: each.keyless === true,
      key: { configured: byKey.has(decisionModelKeySetting(each.id)) },
      keyCheck: readKeyCheck(byKey.get(decisionModelKeyCheckSetting(each.id))),
    })),
  };
}

export const speechFilterInput = z.object({
  /** `null` desliga. */
  model: z.string().trim().min(1).max(100).nullable(),
  /** O fornecedor que a pessoa leu no aviso ("O texto ... vai para a TypeSafe"). */
  confirmedProvider: z.string().trim().min(1).max(80).optional(),
});

async function upsert(q: OrgQuery, key: string, value: unknown, secret: boolean, now: Date): Promise<void> {
  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, $4, $5)
     on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
    [q.organizationId, key, JSON.stringify(value), secret, now],
  );
}

/**
 * Liga, troca ou desliga o filtro. Ligar um modelo que processa fora deste servidor pede
 * `confirmedProvider` igual ao fornecedor dele, a cada vez que o modelo muda ou volta a ser ligado;
 * salvar de novo o mesmo modelo, já confirmado, mantém a confirmação. Sem a chave salva, não liga:
 * a ligação abriria o filtro sem chave e só diria isso na linha do tempo.
 */
export async function saveSpeechFilter(q: OrgQuery, session: Session, now: Date, body: z.output<typeof speechFilterInput>): Promise<SpeechFilterView> {
  if (body.model === null) {
    await q.exec("delete from settings where key = $1 or key = $2", [DECISION_MODEL_SETTING, DECISION_MODEL_CONFIRMATION_SETTING]);
    return readSpeechFilter(q);
  }
  const model = await offeredModel(body.model);
  if (!model.keyless && !(await q.one("select 1 from settings where key = $1", [decisionModelKeySetting(model.id)]))) {
    throw new ApiError(400, "decision_model_key_missing", `${model.label} has no key saved: save its key first.`);
  }
  if (processesElsewhere(model.processingLocation)) {
    if (body.confirmedProvider !== undefined && body.confirmedProvider !== model.provider) {
      throw new ApiError(400, "provider_confirmation_invalid", `The confirmation names "${body.confirmedProvider}", but ${model.label} sends the call text to "${model.provider}".`);
    }
    const current = await readSpeechFilter(q);
    const confirmed = current.model === model.id && current.confirmation?.provider === model.provider;
    if (body.confirmedProvider === undefined && !confirmed) {
      throw new ApiError(
        400,
        "provider_confirmation_required",
        `${model.label} sends the text of what the caller says to "${model.provider}", outside this server. Confirm it with confirmedProvider: "${model.provider}".`,
      );
    }
    // Só a confirmação nova é gravada: salvar de novo o mesmo modelo já confirmado mantém quem
    // confirmou e quando, e não deixa outro recibo.
    if (body.confirmedProvider !== undefined && !confirmed) {
      await upsert(q, DECISION_MODEL_CONFIRMATION_SETTING, { model: model.id, provider: model.provider, userId: session.userId, name: session.name, at: now.toISOString() }, false, now);
      // O recibo, na mesma transação, só de acréscimo e com o nome do momento. A `settings` acima é a
      // trava de agora e sai ao desligar ou trocar de modelo; o recibo fica no Registro da privacidade.
      await recordOrgEvent(q, "decision_model_provider_confirmed", { decisionModel: model.id, provider: model.provider, confirmedByName: session.name }, now, session.userId);
    }
  } else {
    await q.exec("delete from settings where key = $1", [DECISION_MODEL_CONFIRMATION_SETTING]);
  }
  await upsert(q, DECISION_MODEL_SETTING, model.id, false, now);
  return readSpeechFilter(q);
}

/** A chave de um modelo oferecido que pede chave. */
export async function keyedModel(id: string): Promise<DecisionModel> {
  const model = await offeredModel(id);
  if (model.keyless || !model.checkKey) throw new ApiError(400, "decision_model_keyless", `${model.label} does not take a key.`);
  return model;
}

/** Grava a chave cifrada; o teste da chave anterior deixa de valer. Devolve o valor cifrado, para o teste. */
export async function saveDecisionModelKey(q: OrgQuery, deps: ServerDeps, model: DecisionModel, apiKey: string): Promise<string> {
  const stored = encryptSecret(apiKey, deps.secretKey);
  await q.exec("delete from settings where key = $1", [decisionModelKeyCheckSetting(model.id)]);
  await upsert(q, decisionModelKeySetting(model.id), stored, true, deps.clock.now());
  return stored;
}

/** Remove a chave e o último teste. O modelo ligado não perde a chave por baixo: desligue antes. */
export async function removeDecisionModelKey(q: OrgQuery, model: DecisionModel): Promise<void> {
  const current = decisionModelOf((await q.one<{ value: unknown }>("select value from settings where key = $1", [DECISION_MODEL_SETTING]))?.value);
  if (current === model.id) throw new ApiError(409, "decision_model_in_use", `${model.label} is the speech filter in use: turn the filter off before removing its key.`);
  await q.exec("delete from settings where key = $1 or key = $2", [decisionModelKeySetting(model.id), decisionModelKeyCheckSetting(model.id)]);
}

/**
 * Cinco testes por modelo e organização a cada dez minutos, o mesmo limite da chave do motor: o bastante
 * para colar, errar e colar de novo, e pouco para o botão martelar o fornecedor com a chave de alguém.
 */
export const decisionKeyCheckLimiter = createRateLimiter(5, 10 * 60 * 1000);

type Org = <T>(run: (q: OrgQuery) => Promise<T>) => Promise<T>;

/**
 * Testa a chave gravada (`stored`, cifrada) pelo `checkKey` do modelo e guarda o resultado, só se a
 * chave testada ainda é a salva. `null` quando o limite adiou o teste: nada sai para o fornecedor.
 * Roda fora de transação. O resultado é o vocabulário fechado; nunca a chave nem o texto do fornecedor.
 */
export async function testDecisionModelKey(deps: ServerDeps, org: Org, organizationId: string, model: DecisionModel, stored: string): Promise<KeyCheckView | null> {
  if (!model.checkKey || !decisionKeyCheckLimiter.take(`${organizationId}:${model.id}`, deps.clock.now())) return null;
  const check = await model.checkKey(decryptSecret(stored, deps.secretKey), { fetch: deps.fetch });
  const view = storedKeyCheck.parse({ ...check, checkedAt: deps.clock.now().toISOString() });
  await org((q) =>
    q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at)
       select $1, $2, $3, false, $4 where exists (select 1 from settings where key = $5 and value = $6::jsonb)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, decisionModelKeyCheckSetting(model.id), JSON.stringify(view), deps.clock.now(), decisionModelKeySetting(model.id), JSON.stringify(stored)],
    ),
  );
  return view;
}
