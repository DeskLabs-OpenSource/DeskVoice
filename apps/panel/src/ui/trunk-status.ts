import { inboundFilterOn } from "@deskvoice/core/inbound-filter";
import type { Trunk } from "./types";

/**
 * O motivo gravado da última falha da linha, para a tela mostrar sem pedir um teste. Inclui a
 * linha que o processo de voz deixou de fora da configuração: ela fica "Com falha", e o motivo
 * diz o que corrigir.
 */
export function trunkFailure(trunk: Pick<Trunk, "status" | "lastError"> | null): string | null {
  if (trunk === null || (trunk.status !== "fail" && trunk.status !== "warn")) return null;
  return trunk.lastError || null;
}

/**
 * O começo do motivo da linha que o processo de voz deixou de fora do arquivo (`LEFT_OUT` em
 * `apps/voice/src/trunks.ts`; os dois mudam juntos). Só essa linha não aceita ligação nenhuma.
 */
const LEFT_OUT = "This line was left out of the telephony configuration";

/**
 * A linha está na central, mas sem filtro de entrada (R14, contrato 8): o conjunto liberado foi
 * calculado e ficou vazio, o que só acontece com nome no `host` que ainda não resolveu. Ela pode
 * estar "Com falha" por outro motivo (o provedor não responde) e mesmo assim aceitar ligação.
 * Antes da primeira aplicação (`unverified`) e na linha deixada de fora, não.
 */
export function filterOff(trunk: Pick<Trunk, "status" | "lastError" | "inboundAllowed">, hostIsName: boolean): boolean {
  if (!hostIsName || (trunk.inboundAllowed ?? []).length > 0) return false;
  if (trunk.status !== "warn" && trunk.status !== "fail" && trunk.status !== "ok") return false;
  return !(trunk.lastError ?? "").startsWith(LEFT_OUT);
}

/** O que a caixa "Aceita ligações de" mostra: as chaves do dicionário da linha, escolhidas aqui. */
export interface AllowedView {
  /** O rótulo antes da lista: o que a central aceita agora, ou o que o filtro aceitaria se ligado. */
  label: "allowed" | "allowedIfOn";
  /** A lista de endereços, ou a frase no lugar dela quando a lista está vazia. */
  value: "list" | "allowedAny" | "allowedEmpty" | "allowedNone";
  /** Se a tela diz que a central recusa os outros endereços. */
  others: boolean;
  /** O aviso em negrito da linha por registro com o filtro desligado. */
  warning: null | "filterSwitchedOff" | "filterSwitchedOffEmpty" | "filterSwitchedOffPending";
}

/**
 * Uma frase só, e verdadeira sobre o que a central faz agora, em cada estado da linha (R14). A
 * linha por IP filtra sempre e fica nos três primeiros. Com a lista vazia, `filterOff` diz se a
 * linha está na central (nome que nunca resolveu: aceita de qualquer endereço, com o filtro ligado
 * ou desligado, porque sem endereço a central não recusa nada) ou fora dela (não aceita ligação).
 *
 * | filtro    | lista             | rótulo e valor          | aviso                    |
 * |-----------|-------------------|-------------------------|--------------------------|
 * | ligado    | com endereços     | allowed: lista + outros | nenhum                   |
 * | ligado    | vazia, na central | allowed: allowedEmpty   | nenhum                   |
 * | ligado    | vazia, fora       | allowed: allowedNone    | nenhum                   |
 * | desligado | com endereços     | allowedIfOn: lista      | filterSwitchedOff        |
 * | desligado | vazia, na central | allowed: allowedAny     | filterSwitchedOffEmpty   |
 * | desligado | vazia, fora       | allowed: allowedNone    | filterSwitchedOffPending |
 */
export function allowedView(trunk: Pick<Trunk, "authMode" | "inboundFilter" | "status" | "lastError" | "inboundAllowed">, hostIsName: boolean): AllowedView {
  const on = inboundFilterOn(trunk);
  if ((trunk.inboundAllowed ?? []).length > 0) {
    return on ? { label: "allowed", value: "list", others: true, warning: null } : { label: "allowedIfOn", value: "list", others: false, warning: "filterSwitchedOff" };
  }
  const inServer = filterOff(trunk, hostIsName);
  if (on) return { label: "allowed", value: inServer ? "allowedEmpty" : "allowedNone", others: false, warning: null };
  return inServer ? { label: "allowed", value: "allowedAny", others: false, warning: "filterSwitchedOffEmpty" } : { label: "allowed", value: "allowedNone", others: false, warning: "filterSwitchedOffPending" };
}
