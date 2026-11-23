"use client";

import { useEffect, useState } from "react";
import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { ActionStatus, useAction } from "../../../ui/errors";
import { Button, Field, Panel, TextArea } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Setting } from "../../../ui/types";
import { put } from "./setting-api";

/** A âncora do bloco: o "mudou para…" de Regras das ligações aponta para ela. */
export const RECORDING_NOTICE_ANCHOR = "aviso-de-gravacao";

/**
 * O aviso de gravação que o agente diz no começo da chamada. Quem não configura lê o texto, com o
 * campo desabilitado: por isso o bloco fica fora do `PrivacyPanel`, que some para o operador.
 */
export function RecordingNoticePanel() {
  const t = useDict(ptBR, en, es);
  const canConfigure = useCanConfigure();
  const recording = useApi<Setting<string>>("/settings/recording_notice.text");
  const saveRecording = useAction();
  const [notice, setNotice] = useState("");

  useEffect(() => setNotice(recording.data?.value ?? ""), [recording.data]);

  return (
    <div id={RECORDING_NOTICE_ANCHOR} className="scroll-mt-24 lg:scroll-mt-6">
      <Panel title={t.recordingTitle} description={t.recordingLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveRecording.run(() => put("recording_notice.text", notice.trim() || null)).then(recording.reload);
          }}
        >
          <Field label={t.recordingText}>
            <TextArea rows={3} disabled={!canConfigure} placeholder={t.recordingExample} value={notice} onChange={(event) => setNotice(event.target.value)} maxLength={500} />
          </Field>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={saveRecording.busy}>
                {t.saveRecording}
              </Button>
              <ActionStatus action={saveRecording} />
            </div>
          ) : null}
        </form>
      </Panel>
    </div>
  );
}
