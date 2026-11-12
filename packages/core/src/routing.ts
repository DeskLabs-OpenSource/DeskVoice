import type { Db } from "./types";
import { withSystem } from "./with-org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InboundRoute {
  organizationId: string;
  trunkId: string;
  phoneNumberId: string | null;
  agentId: string | null;
}

/**
 * Decide para quem vai uma chamada recebida. Quem define a organização é o tronco por onde ela
 * chegou; o número discado só é procurado dentro dessa organização, nunca em outra.
 *
 * Devolve `null` se o tronco não existe. Devolve a rota com `phoneNumberId` e `agentId` nulos
 * quando não dá para saber o número: quem chama deve recusar a ligação. Sem número discado
 * (tronco que manda "s"), só vale se o tronco tiver exatamente um número.
 */
export async function resolveInboundRoute(db: Db, trunkId: string, dialedE164: string | null): Promise<InboundRoute | null> {
  return withSystem(db, async (q) => {
    // Id que não é uuid faria a consulta lançar erro de conversão; para o roteamento é só "não existe".
    if (!UUID.test(trunkId)) return null;
    const trunk = await q.one<{ organization_id: string }>("select organization_id from trunks where id = $1", [trunkId]);
    if (!trunk) return null;

    const numbers =
      dialedE164 === null
        ? // Limite 2: basta saber se é um só.
          await q.many<{ id: string; agent_id: string | null }>(
            "select id, agent_id from phone_numbers where organization_id = $1 and trunk_id = $2 limit 2",
            [trunk.organization_id, trunkId],
          )
        : await q.many<{ id: string; agent_id: string | null }>(
            "select id, agent_id from phone_numbers where organization_id = $1 and e164 = $2",
            [trunk.organization_id, dialedE164],
          );
    const number = numbers.length === 1 ? numbers[0] : undefined;
    return { organizationId: trunk.organization_id, trunkId, phoneNumberId: number?.id ?? null, agentId: number?.agent_id ?? null };
  });
}

/**
 * Alguma organização pediu o serviço de ligação pelo WhatsApp. O processo de voz pergunta isto na
 * partida, para ouvir o WaCalls desde já: é por ele que as ligações chegam. Só um sim ou não, sem
 * dado de organização nenhuma.
 */
export async function whatsappCallsWanted(db: Db): Promise<boolean> {
  return withSystem(db, async (q) => (await q.one("select 1 as wanted from whatsapp_call_sessions where service_wanted limit 1")) !== null);
}
