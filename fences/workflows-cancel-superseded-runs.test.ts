// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm cada push num PR deixava o run anterior vivo e a fila de CI entupiu no teto de
//   jobs simultâneos da conta. Um run por PR: o novo cancela o anterior.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, expectClean, fixture, jobs, loadWorkflows, triggers } from "./_lib";

function cancelsPerPullRequest(concurrency: unknown): boolean {
  const { group, "cancel-in-progress": cancel } = asRecord(concurrency);
  const perPr = typeof group === "string" && group.includes("github.event.pull_request.number");
  // Aceita `true` ou uma expressão que cancela em evento de PR (a main não se cancela).
  const cancels = cancel === true || (typeof cancel === "string" && cancel.includes("pull_request"));
  return perPr && cancels;
}

function check(root: string): string[] {
  const violations: string[] = [];
  for (const { file, doc } of loadWorkflows(root)) {
    if (!triggers(doc).includes("pull_request")) continue;
    const allJobs = jobs(doc);
    const everyJob = allJobs.length > 0 && allJobs.every(([, job]) => cancelsPerPullRequest(job.concurrency));
    if (!cancelsPerPullRequest(doc.concurrency) && !everyJob) {
      violations.push(`${file}: roda em pull_request sem concorrência por número do PR com cancel-in-progress`);
    }
  }
  return violations;
}

describe("workflows-cancel-superseded-runs", () => {
  it("todo workflow de pull_request cancela o run anterior do mesmo PR", () => {
    expectClean(
      check(REPO_ROOT),
      "Acrescente ao topo do workflow:\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });

  it("reprova workflow de PR sem concorrência, sem cancelamento ou agrupado só por ref", () => {
    expect(check(fixture("workflows-cancel-superseded-runs"))).toEqual([
      ".github/workflows/group-by-ref.yml: roda em pull_request sem concorrência por número do PR com cancel-in-progress",
      ".github/workflows/no-cancel.yml: roda em pull_request sem concorrência por número do PR com cancel-in-progress",
      ".github/workflows/no-concurrency.yml: roda em pull_request sem concorrência por número do PR com cancel-in-progress",
    ]);
  });
});
