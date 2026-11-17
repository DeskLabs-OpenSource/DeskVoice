/**
 * O código da frase de um motivo de `outcome_not_classified` e de `analysis_not_done`. Com endpoint
 * configurado (`endpoint: true` no payload), a chave recusada é a do endpoint, não a do motor, e a
 * frase diz isso. Com o cérebro escolhido para ler a ligação (`brain` no payload), é a do cérebro.
 */
export const classifyReasonCode = (payload: Record<string, unknown>): string => {
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (reason !== "rejected") return reason;
  if (typeof payload.brain === "string") return "rejected_brain";
  return payload.endpoint === true ? "rejected_endpoint" : reason;
};
