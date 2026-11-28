import { z } from "zod";
import { handle } from "../../../../../../../../server/context";
import { requireAgentTest, segmentId } from "../../../../../../../../server/agent-tests";
import { requireActiveOrganization } from "../../../../../../../../server/shapes";
import { voiceRequest } from "../../../../../../../../server/voice";

// Rodar um teste: o painel só pede. As recusas de antes de começar (teto do mês, outra rodada em
// curso, motor sem teste ou sem chave) são do processo de voz, e o código dele segue até a tela.
export const POST = handle(
  {
    configure: true,
    after: (_test, { deps, session, params }) =>
      voiceRequest(deps, "POST", "/agent-tests/run", z.object({ runId: z.string() }), { organizationId: session.organizationId, testId: params.testId, requestedBy: session.userId }),
  },
  async ({ q, params }) => {
    await requireActiveOrganization(q);
    await requireAgentTest(q, params.id ?? "", segmentId(params.testId));
  },
);
