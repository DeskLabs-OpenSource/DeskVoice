import { handle } from "../../../../../../../../../server/context";
import { agentTestRun, requireAgentTest, segmentId } from "../../../../../../../../../server/agent-tests";

// A rodada, que a tela consulta até ela acabar (`passed`, `failed` ou `error`).
export const GET = handle({}, async ({ q, params }) => {
  const testId = segmentId(params.testId);
  await requireAgentTest(q, params.id ?? "", testId);
  return agentTestRun(q, testId, segmentId(params.runId));
});
