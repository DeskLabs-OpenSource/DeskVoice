import { analystFieldsSchema, recordOrgEvent, type OrgQuery } from "@deskvoice/core";
import type { DecisionModel } from "@deskvoice/voice-engine";
import { z } from "zod";
import { ApiError, type Session } from "../../../../server/context";
import { listDecisionModels } from "../../../../server/pieces";

export const ANALYST_COLUMNS = `id, name, decision_model as "decisionModel", temperature, objections,
  provider_confirmed_by as "providerConfirmedBy", provider_confirmed_at as "providerConfirmedAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export interface AnalystRow {
  id: string;
  name: string;
  decisionModel: string;
  temperature: boolean;
  objections: unknown;
  providerConfirmedBy: string | null;
  providerConfirmedAt: Date | null;
}

const installedModel = async (id: string): Promise<DecisionModel | undefined> => (await listDecisionModels()).find((model) => model.id === id);

const analystFields = analystFieldsSchema.extend({
  decisionModel: analystFieldsSchema.shape.decisionModel.refine(async (id) => (await installedModel(id)) !== undefined, "unknown decision model"),
  // A confirmação da seção 2.1 do desenho: o fornecedor que a pessoa leu na tela ("O texto do que a
  // pessoa fala na ligação vai para a TypeSafe"). Só vale se for o fornecedor do modelo escolhido.
  confirmedProvider: z.string().trim().min(1).max(80),
});
export const analystPatch = analystFields.partial();
export const analystCreate = analystPatch.required({ name: true, decisionModel: true });
export type AnalystPatch = z.output<typeof analystPatch>;

/** O texto da ligação sai do servidor com este modelo: pede a confirmação nomeando o fornecedor. */
export const processesElsewhere = (model: DecisionModel): boolean => model.processingLocation.kind !== "this-server";

type Consent = "clear" | "keep" | "record";

/**
 * O que fazer com `provider_confirmed_by`/`_at` ao salvar (seção 2.1 do desenho):
 * - modelo que processa aqui (o simulado): nada a confirmar, e uma confirmação antiga sai;
 * - modelo que processa fora, sem confirmação vigente (analista novo, modelo trocado, ou nunca
 *   confirmado): recusa sem a confirmação, e grava quem confirmou com ela;
 * - mesmo modelo, já confirmado: mantém, e uma nova confirmação é gravada de novo.
 * Um modelo gravado que esta versão não tem mais fica como está: não há fornecedor para conferir.
 */
function consentFor(model: DecisionModel | undefined, needsNew: boolean, confirmedProvider: string | undefined): Consent {
  if (!model) return "keep";
  if (!processesElsewhere(model)) return "clear";
  if (confirmedProvider !== undefined && confirmedProvider !== model.provider) {
    throw new ApiError(400, "provider_confirmation_invalid", `The confirmation names "${confirmedProvider}", but ${model.label} sends the call text to "${model.provider}".`);
  }
  if (confirmedProvider !== undefined) return "record";
  if (needsNew) {
    throw new ApiError(
      400,
      "provider_confirmation_required",
      `${model.label} sends the text of what the caller says to "${model.provider}", outside this server. Confirm it with confirmedProvider: "${model.provider}".`,
    );
  }
  return "keep";
}

/**
 * Grava o analista (novo, sem `current`, ou a edição dele) com a confirmação do fornecedor resolvida,
 * e o recibo `analyst_provider_confirmed` na mesma transação quando há confirmação nova. O recibo é
 * só de acréscimo e leva o nome de quem confirmou no momento: `provider_confirmed_by` vira nulo se a
 * pessoa sair da equipe, e a prova continua ali.
 */
export async function saveAnalyst(q: OrgQuery, session: Session, now: Date, body: AnalystPatch, current: AnalystRow | null): Promise<AnalystRow> {
  const name = body.name ?? current?.name ?? "";
  const decisionModel = body.decisionModel ?? current?.decisionModel ?? "";
  const temperature = body.temperature ?? current?.temperature ?? true;
  const objections = body.objections ?? current?.objections ?? [];
  const model = await installedModel(decisionModel);
  const needsNew = current === null || current.decisionModel !== decisionModel || current.providerConfirmedAt === null;
  const consent = consentFor(model, needsNew, body.confirmedProvider);
  const confirmedBy = consent === "record" ? session.userId : consent === "clear" ? null : (current?.providerConfirmedBy ?? null);
  const confirmedAt = consent === "record" ? now : consent === "clear" ? null : (current?.providerConfirmedAt ?? null);

  const values = [name, decisionModel, temperature, JSON.stringify(objections), confirmedBy, confirmedAt, now];
  const saved = current
    ? await q.one<AnalystRow>(
        `update analysts set name = $1, decision_model = $2, temperature = $3, objections = $4, provider_confirmed_by = $5,
                provider_confirmed_at = $6, updated_at = $7
          where id = $8 returning ${ANALYST_COLUMNS}`,
        [...values, current.id],
      )
    : await q.one<AnalystRow>(
        `insert into analysts (organization_id, name, decision_model, temperature, objections, provider_confirmed_by, provider_confirmed_at, created_at, updated_at)
         values ($8, $1, $2, $3, $4, $5, $6, $7, $7) returning ${ANALYST_COLUMNS}`,
        [...values, q.organizationId],
      );
  if (!saved) throw new ApiError(404, "not_found", "Not found.");
  if (consent === "record" && model) {
    await recordOrgEvent(
      q,
      "analyst_provider_confirmed",
      { analystId: saved.id, analystName: saved.name, decisionModel: model.id, provider: model.provider, confirmedByName: session.name },
      now,
      session.userId,
    );
  }
  return saved;
}
