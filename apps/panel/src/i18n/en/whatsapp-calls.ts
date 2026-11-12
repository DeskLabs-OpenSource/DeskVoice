import type { WhatsAppCallsDictionary } from "../pt-BR/whatsapp-calls";

const whatsappCalls: WhatsAppCallsDictionary = {
  title: "WhatsApp calls",
  lead: "Connect the company number by reading a QR code, as one more WhatsApp device. The chosen agent answers right away whoever calls that number on WhatsApp.",
  howItWorks:
    "The agent answers as soon as the call arrives, with the same recording notice and the same cost and duration limits as calls through the carrier, and the call counts toward the same limit of incoming calls at the same time. This channel has no transfer to a person: when someone asks to talk to the team, the agent offers to take a message.",
  answeredBy: "Answered by",
  nobody: "Nobody: calls ring only on the phone",
  noAgent: "No agent answers this number. WhatsApp calls keep ringing only on the phone until you choose one.",
  unavailable: "The voice process of this server does not have the key of the WhatsApp calls service yet. This happens when the update was made by an old updater. Run on the server, once:",
  serviceAbsent: "The WhatsApp calls service is not installed on this server.",
  serviceCost:
    "It is a separate piece, downloaded and started only if you ask. The image is about 19 MB to download (checked in the image registry on 2026-11-12). The memory and disk space it uses have not been measured yet; the memory ceiling is 256 MB.",
  installService: "Install the WhatsApp calls service",
  servicePreparing: "Preparing the service: the server is downloading WhatsApp calls. It takes a few minutes, and this screen follows along.",
  serviceFailed: {
    no_disk: "The server does not have disk space for the WhatsApp calls service. Nothing was downloaded.",
    pull_failed: "The server could not download the WhatsApp calls service. It is usually the server's internet, the image registry being down, or lack of disk space.",
    start_failed: "The server downloaded the WhatsApp calls service, but it did not start. It is usually lack of memory or disk space.",
    remove_failed: "The server could not remove the WhatsApp calls service.",
    unknown: "The server could not install the WhatsApp calls service.",
  },
  noDisk: "The server does not have disk space for the WhatsApp calls service: there are {free} GB free and it needs {needed} GB. About {missing} GB are missing. Nothing was downloaded. Free some space (old backups in backups/, for example) or enlarge the disk.",
  lowMemory: "When the service was installed, the server had less available memory than its ceiling (256 MB). It is running, but the rest of DeskVoice may run short of memory. Keep an eye on the server, or remove the service.",
  imageKept: "The service was removed and the memory was freed, but its files did not leave the disk, because something else on this server uses them. The server tries again by itself every minute. To try now, run on the server:",
  serviceRetry: "The server tries again by itself in about 10 minutes. The record of what happened stays on the server, in deploy/agent/agent.log.",
  serviceRemoving: "Removing the WhatsApp calls service from the server. It takes up to a minute.",
  removeService: "Remove the WhatsApp calls service",
  removeServiceConfirm:
    "Remove the WhatsApp calls service from this server? No number stays connected for calls, and its memory and disk are freed. If a number was ever connected here, check on its phone, in Linked devices, that this device is gone, and remove it if it is still there. To come back, just install it again.",
  removeServiceConfirmPhone:
    "Remove the WhatsApp calls service from this server? The number {phone} was the last one connected here: check on its phone, in Linked devices, that this device is gone, and remove it if it is still there. The service's memory and disk are freed. To come back, just install it again.",
  removeServiceYes: "Remove the WhatsApp calls service",
  agentNever: "The agent of this server, which installs and removes the service, has not talked to the panel yet. Without it, the request waits. To run it now, run on the server:",
  agentSilent: "The agent of this server, which installs and removes the service, is not responding. The request waits until it comes back. To run it now, run on the server:",
  riskTitle: "Before connecting",
  risk: "WhatsApp calls use an unofficial client (WaCalls), which connects the number as one more device, and not Meta's official API. WhatsApp may restrict or ban the number, without notice. Use a number dedicated to customer service, never your personal one.",
  devices:
    "WhatsApp accepts up to four devices linked to a number, and calls ring on all of them. This service takes one of those places. With more than four devices (accounts with Meta Verified, for example), calls ring only on the phone, and this service stops receiving them.",
  messagesNumber:
    "The number {phone} is connected for messages, under WhatsApp. If you connect the same number here, there will be two devices linked to the same WhatsApp: if the number is banned, messages and calls stop together.",
  sameNumber:
    "This number is also connected for messages. There are two devices linked to the same WhatsApp. If the number is banned, messages and calls stop together. WhatsApp accepts up to four linked devices; with more than that, calls ring only on the phone.",
  connect: "Connect",
  starting: "Preparing the connection. The QR code appears in a few seconds.",
  qrTitle: "Read the code with the number's phone",
  steps: [
    "Open WhatsApp on the phone of the number that will receive the calls.",
    "Tap More options (or Settings) and then Linked devices.",
    "Tap Link a device and point the camera at this code.",
  ],
  qrAlt: "QR code to connect the number to WhatsApp calls",
  qrRenew: "The code is replaced by itself a few times and lasts a few minutes. This screen follows along and tells you when it connects.",
  qrBetween: "Generating the next code.",
  connected: "Connected",
  connectedNumber: "Connected number: {phone}",
  connectedUnknown: "A number is connected.",
  since: "Connected since {when}.",
  disconnect: "Disconnect",
  disconnectConfirm: "Disconnect {phone} from WhatsApp calls? The device leaves Linked devices on the phone, and coming back will require reading the QR code again.",
  disconnectYes: "Disconnect {phone}",
  thisNumber: "the connected number",
  failed: {
    logged_out:
      "The number disconnected: the device was removed in Linked devices, on the phone, or WhatsApp ended the connection. WhatsApp disconnects linked devices when the main phone goes unused for more than 14 days.",
    qr_expired: "The QR code was not read in time, and the attempt was ended.",
    missing:
      "The WhatsApp calls service no longer has the data of this connection. This happens after restoring a backup, moving servers or reinstalling the service, because the pairing is not in the backup.",
  },
  reconnect: "Connect again",
  newCode: "Generate a new code",
};

export default whatsappCalls;
