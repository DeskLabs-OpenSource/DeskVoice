import type { PrivacyDictionary } from "../pt-BR/privacy";

const privacy: PrivacyDictionary = {
  retentionTitle: "How long conversations are kept",
  retentionLead:
    "The transcript of each call, what the caller and the agent said, stays in the database until it falls outside the retention period. After that, the text is replaced by a marker; the call, its time, the summary and the rest of the timeline remain.",
  retentionDays: "Keep for (days)",
  retentionHint: "Empty keeps it forever. The shortest period is {min} days.",
  currentForever: "This organization currently keeps transcripts forever.",
  currentDays: "This organization currently keeps transcripts for {days} days.",
  irreversible:
    "Text that is removed does not come back, neither through this panel nor through the server. Backups already made keep the text until they are discarded. The call summary and the data sent by tools are not removed with the period.",
  save: "Save period",
  confirmTitle: "Delete the text of conversations older than {days} days?",
  confirmBody:
    "The text of those conversations leaves the database in a moment, and once a day from then on. What is removed does not come back. Backups already made keep the text until they are discarded.",
  confirmYes: "Delete and keep for {days} days",
  exportTitle: "Data about a caller",
  exportLead:
    "When someone asks what the phone system keeps about them, enter the phone number. You get a file with the calls from that number in this organization, their events and the do-not-call entry. Speech already removed by the retention period appears as deleted.",
  exportPhone: "Phone",
  exportPhoneHint: "The search is by number. If the person called from another phone, export each one.",
  exportRun: "Export",
  exportDone: "File for {phone} downloaded. Calls: {calls}. Events: {events}.",
  exportDoneDnc: "The number is on the do-not-call list, and that is in the file too.",
  exportEmpty: "This organization has no record of {phone}. No file was downloaded, and the lookup is in the record below.",
  exportCare: "The file contains personal data. Deliver it through the channel agreed with the person and delete the copy from this computer afterwards.",
  fileName: "data-{phone}-{date}.ndjson",
  historyTitle: "Record",
  historyLead: "Who changed the period, what was removed by it and who exported the data of which phone. The 50 most recent.",
  historyEmpty: "Nothing recorded yet.",
  history: {
    transcript_retention_changed: "{who} changed the retention period from {from} to {to}.",
    transcripts_purged: "The text of speech older than {days} days was deleted by the retention period. Deleted: {count}.",
    caller_data_exported: "{who} exported the data of {phone}. Calls: {calls}. Events: {events}.",
  },
  forever: "forever",
  days: "{n} days",
  removedPerson: "Someone who left the team",
};

export default privacy;
