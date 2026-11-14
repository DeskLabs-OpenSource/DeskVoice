import type { PrivacyDictionary } from "../pt-BR/privacy";

const privacy: PrivacyDictionary = {
  recordingTitle: "Call recording",
  recordingLead:
    "Records the audio of each call in this organization to a file you can play on the call page: the caller on one channel, the agent on the other. It comes turned off. It applies from the next call on.",
  recordingSwitch: "Record the audio of calls",
  recordingDisk:
    "Each minute of a call takes about 1.9 MB on the server disk. That is arithmetic from the format (two channels, 8 kHz, 16 bits), not a measurement.",
  recordingKeeps:
    "Turning it on or off deletes nothing. Recordings already made follow the retention period below: they are removed together with the conversation text, and without a period they are kept forever. Today's backups do not include the recordings. Check that the notice at the start of the call, under Settings → Calls, tells callers the conversation is kept.",
  recordingForever:
    "The retention period is empty: recordings are kept forever, and the server disk grows without limit, about 1.9 MB per minute of call. Set a period below so old recordings are removed.",
  recordingStates: { on: "on", off: "off" },
  retentionTitle: "How long conversations are kept",
  retentionLead:
    "The transcript of each call, what the caller and the agent said, stays in the database until it falls outside the retention period. After that, the text is replaced by a marker and the recording, if any, is deleted; the call, its time, the summary and the rest of the timeline remain. Follow-ups closed longer ago than the period, counted from when they were closed, are deleted too; an open follow-up stays until someone closes it.",
  retentionDays: "Keep for (days)",
  retentionHint: "Empty keeps it forever. The shortest period is {min} days.",
  currentForever: "This organization currently keeps transcripts forever.",
  currentDays: "This organization currently keeps transcripts for {days} days.",
  irreversible:
    "Text that is removed does not come back, neither through this panel nor through the server. Backups already made keep the text until they are discarded. The call summary and the data sent by tools are not removed with the period.",
  save: "Save period",
  confirmTitle: "Delete the text of conversations older than {days} days?",
  confirmBody:
    "The text of those conversations leaves the database in a moment, and once a day from then on; their recordings, if any, go with it. What is removed does not come back. Backups already made keep the text until they are discarded.",
  confirmYes: "Delete and keep for {days} days",
  exportTitle: "Data about a caller",
  exportLead:
    "When someone asks what the phone system keeps about them, enter the phone number. You get a file with the calls from that number in this organization, their events, the follow-ups for that number, open and closed, and the do-not-call entry. Speech already removed by the retention period appears as deleted. Each call says whether it has a recording; the audio is not in the file and can be played on the call page.",
  exportPhone: "Phone",
  exportPhoneHint: "The search is by number. If the person called from another phone, export each one.",
  exportRun: "Export",
  exportDone: "File for {phone} downloaded. Calls: {calls}. Events: {events}.",
  exportDoneFollowUps: "Follow-ups: {count}.",
  exportDoneDnc: "The number is on the do-not-call list, and that is in the file too.",
  exportEmpty: "This organization has no record of {phone}. No file was downloaded, and the lookup is in the record below.",
  exportCare: "The file contains personal data. Deliver it through the channel agreed with the person and delete the copy from this computer afterwards.",
  fileName: "data-{phone}-{date}.ndjson",
  erasureTitle: "Erase at the caller's request",
  erasureLead:
    "When someone asks the phone system to erase what it keeps about them, enter the phone number and first see what would be removed. In the calls from that number, the speech, the summary, the outcome quote, the analysis text, the reason given to stop recording, tool arguments and replies, the text of approvals and notifications, the follow-ups and the recording are removed, and the phone number disappears from those calls. The service record stays: time, duration, cost, outcome and score. If the number is on the do-not-call list, it stays there: that is what prevents calling again someone who asked not to be called.",
  erasureBackups: "Backup copies the operator has already made are not reached by this erasure and keep the data until they are discarded.",
  erasurePhone: "Phone",
  erasurePhoneHint: "The search is by number. If the person called from another phone, erase each one.",
  erasurePreview: "See what would be removed",
  erasureCounts: "Calls: {calls}. Events: {events}. Follow-ups: {followUps}. Notifications: {notifications}. Approvals: {approvals}. Recordings: {recordings}.",
  erasureEmpty: "This organization has nothing to erase for {phone}.",
  erasureLive: "There is a call in progress with {phone}. While it lasts, the conversation keeps being recorded. Wait for it to end and see the preview again.",
  erasureConfirmTitle: "Erase what this organization keeps about {phone}?",
  erasureConfirmBody: "What is removed does not come back, neither through this panel nor through the server. The recordings are removed right after the database confirms.",
  erasureConfirmYes: "Erase the data of {phone}",
  erasureDone: "The data of {phone} was erased.",
  erasureDoneRecordings: "The recordings are removed in a moment. The record below says how many were removed.",
  historyTitle: "Record",
  historyLead: "Who changed the period or the recording, what was removed by it, who exported the data of which phone and who erased data at a caller's request. The 50 most recent.",
  historyEmpty: "Nothing recorded yet.",
  history: {
    transcript_retention_changed: "{who} changed the retention period from {from} to {to}.",
    transcripts_purged: "The text of speech older than {days} days was deleted by the retention period. Deleted: {count}.",
    caller_data_exported: "{who} exported the data of {phone}. Calls: {calls}. Events: {events}.",
    call_recording_changed: "{who} turned call recording {state}.",
    caller_data_erased: "{who} erased, at the caller's request, the data of the phone ending in {suffix}. Calls: {calls}. Recordings: {recordings}.",
    caller_recordings_erased: "Call recordings erased at the caller's request: {removed}.",
  },
  purgedRecordings: "Recordings deleted: {count}.",
  purgedFollowUps: "Closed follow-ups deleted: {count}.",
  erasedRecordingsLeft: "Recordings not removed: {left}. The routine tries again, and so does a new request.",
  forever: "forever",
  days: "{n} days",
  removedPerson: "Someone who left the team",
};

export default privacy;
