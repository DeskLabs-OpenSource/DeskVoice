/**
 * O código da frase de um motivo de `outcome_not_classified` e de `analysis_not_done`. Com endpoint
 * configurado (`endpoint: true` no payload), a chave recusada é a do endpoint, não a do motor, e a
 * frase diz isso.
 */
export const classifyReasonCode = (payload: Record<string, unknown>): string => {
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  return reason === "rejected" && payload.endpoint === true ? "rejected_endpoint" : reason;
};
