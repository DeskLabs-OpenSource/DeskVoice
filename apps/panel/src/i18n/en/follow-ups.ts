import type { FollowUpsDictionary } from "../pt-BR/follow-ups";

const followUps: FollowUpsDictionary = {
  title: "Follow-ups",
  lead: "What was agreed on calls and needs a person: call back, send, check. Each one has an owner, a due time and a closing that stays on the call timeline.",
  views: { mine: "Mine", open: "Open", overdue: "Overdue", closed: "Closed" },
  empty: {
    mine: "No open follow-ups assigned to you.",
    open: "No open follow-ups.",
    overdue: "No overdue follow-ups.",
    closed: "No closed follow-ups yet.",
  },
  emptyBody: "When an agent with the create_task tool agrees on a call back during a call, the follow-up shows up here.",
  team: "The team",
  owner: "Owner",
  due: "Due",
  overdue: "Overdue",
  olderThanRetention: "Open for longer than the retention period ({days} days). An open follow-up is never deleted by the retention period: close or cancel it once it is settled.",
  caller: "Phone",
  openCall: "See the call",
  status: { open: "Open", done: "Done", canceled: "Canceled" },
  closedBy: "{status} by {name} on {when}",
  removedPerson: "someone who left the team",
  done: "Mark as done",
  cancel: "Cancel follow-up",
  noteDone: "What was done",
  noteDoneHint: "One sentence. Example: Called back, appointment booked for Nov 14.",
  noteCancel: "Why it was canceled",
  noteCancelHint: "One sentence. It stays with the follow-up and shows to whoever opens the call.",
  confirmDone: "Close as done",
  confirmCancel: "Cancel the follow-up",
  keepOpen: "Back",
  changeOwner: "Change the owner",
  notYours: "This follow-up belongs to someone else. Only that person, an owner or an admin can change it.",
};

export default followUps;
