import { PrivacyPanel } from "../privacy-panel";
import { RecordingNoticePanel } from "../recording-notice-panel";

export default function PrivacySettings() {
  // O aviso fica fora do `PrivacyPanel`, que some para quem não configura: o operador continua lendo o texto.
  return (
    <>
      <RecordingNoticePanel />
      <PrivacyPanel />
    </>
  );
}
