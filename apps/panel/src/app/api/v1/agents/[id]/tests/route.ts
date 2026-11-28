import { ApiError, handle } from "../../../../../../server/context";
import { AGENT_TESTS_PER_AGENT, agentTestBody, agentTestState, listAgentTests } from "../../../../../../server/agent-tests";
import { requireAgent } from "../../../../../../server/shapes";

// Os testes do agente (fatia 7c). Quem vê o agente vê os testes e os resultados; quem pode editar o
// agente (`configure`, como `PATCH /agents/{id}`) cria, edita, apaga e roda.
export const GET = handle(
  {
    // O retrato da configuração de agora vem do processo de voz, fora da transação.
    after: async (tests: Awaited<ReturnType<typeof listAgentTests>>, { deps, session, params }) => {
      const state = await agentTestState(deps, session.organizationId, params.id ?? "");
      return {
        textMode: state.textMode,
        configHash: state.configHash,
        tests: tests.map((test) => ({
          ...test,
          // "Não rodado com a configuração atual": a última rodada é de outro retrato. Sem o retrato
          // de agora (voz fora do ar, motor sem teste), a tela não afirma nada.
          stale: test.lastRun !== null && state.configHash !== null && test.lastRun.configHash !== state.configHash,
        })),
      };
    },
  },
  async ({ q, params }) => {
    await requireAgent(q, params.id ?? "");
    return listAgentTests(q, params.id ?? "");
  },
);

export const POST = handle({ body: agentTestBody, configure: true }, async ({ q, params, body }) => {
  await requireAgent(q, params.id ?? "");
  // A trava do agente: dois pedidos ao mesmo tempo não passam juntos do teto.
  await q.exec("select 1 from agents where id = $1 for update", [params.id]);
  const count = await q.one<{ n: number }>("select count(*)::int as n from agent_tests where agent_id = $1", [params.id]);
  if ((count?.n ?? 0) >= AGENT_TESTS_PER_AGENT) {
    throw new ApiError(409, "agent_tests_limit", `An agent has at most ${AGENT_TESTS_PER_AGENT} tests.`, { limit: AGENT_TESTS_PER_AGENT });
  }
  return q.one<{ id: string }>(
    "insert into agent_tests (organization_id, agent_id, name, turns) select organization_id, id, $2, $3 from agents where id = $1 returning id",
    [params.id, body.name, JSON.stringify(body.turns)],
  );
});
