import { ApiError, handle, notFound } from "../../../../../../server/context";
import { voiceHealthSchema, voiceRequest } from "../../../../../../server/voice";
import { applyTrunks } from "../../store";

type Step = { step: "apply" | "asterisk" | "trunk"; status: "ok" | "warn" | "fail" | "skipped"; detail: string };

/** Testa a linha em etapas, para a tela dizer ONDE parou em vez de só "não funcionou". */
export const POST = handle(
  {
    configure: true,
    after: async (trunkId: string, { deps, session, org }) => {
      const applied = await applyTrunks(deps, session.organizationId);
      const steps: Step[] = [{ step: "apply", status: applied.applied ? "ok" : "fail", detail: applied.detail }];
      if (applied.applied) {
        try {
          const health = await voiceRequest(deps, "GET", "/health", voiceHealthSchema);
          const trunk = health.trunks.find((candidate) => candidate.id === trunkId);
          steps.push({ step: "asterisk", ...health.asterisk });
          steps.push({ step: "trunk", status: trunk?.status ?? "fail", detail: trunk?.detail ?? "The telephony server does not know this line yet." });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          steps.push({ step: "asterisk", status: "fail", detail: error.message });
        }
      }
      for (const step of ["asterisk", "trunk"] as const) {
        if (!steps.some((done) => done.step === step)) steps.push({ step, status: "skipped", detail: "" });
      }
      const failed = steps.find((step) => step.status !== "ok");
      const status = failed ? (failed.status === "warn" ? "warn" : "fail") : "ok";
      await org((q) =>
        q.exec("update trunks set status = $2, last_check_at = $3, last_error = $4 where id = $1", [trunkId, status, deps.clock.now(), failed?.detail || null]),
      );
      return { status, steps };
    },
  },
  async ({ q, params }) => {
    const trunk = await q.one<{ id: string }>("select id from trunks where id = $1", [params.id]);
    if (!trunk) throw notFound();
    return trunk.id;
  },
);
