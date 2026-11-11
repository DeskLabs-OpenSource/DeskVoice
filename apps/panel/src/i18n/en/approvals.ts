import type { ApprovalsDictionary } from "../pt-BR/approvals";

const approvals: ApprovalsDictionary = {
  title: "Approvals",
  lead: "Requests an agent made in the middle of a call. Until you answer, the person waits on the line.",
  emptyTitle: "No request is waiting for an answer.",
  emptyBody: "When an agent needs your decision during a call, the request shows up here and at the top of every screen, with the time left.",
  approve: "Approve",
  deny: "Deny",
  timeLeft: "Time left",
  ifNoAnswer: {
    approved: "With no answer in time, the agent goes on as if you had approved.",
    denied: "With no answer in time, the agent goes on as if you had denied.",
  },
  onTheLine: "On the line",
  agent: "Agent",
  openCall: "See the call",
  bannerWaiting: "A person is on the line waiting for this answer.",
  bannerMore: "See all requests ({n})",
  historyTitle: "Recent decisions",
  status: { pending: "Waiting for an answer", approved: "Approved", denied: "Denied", expired: "No answer in time" },
  decidedBy: "by {name}",
};

export default approvals;
