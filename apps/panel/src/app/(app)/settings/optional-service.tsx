"use client";

import { useEffect, type ReactNode } from "react";
import { fill } from "../../../i18n/locales";
import { useLocale } from "../../../i18n/provider";
import { Button, Notice } from "../../../ui/kit";

/**
 * O que os blocos de serviço opcional de Configurações têm em comum (WhatsApp por QR Code, ligação
 * pelo WhatsApp): o serviço que o agente do servidor instala e remove, e o QR Code. Cada bloco
 * passa os próprios textos; a forma e o comportamento são estes.
 */

// O QR Code do WhatsApp vale 20 segundos depois do primeiro. Com 5 segundos entre as consultas a
// tela nunca mostra um código vencido por mais de um quarto da vida dele; mais que isso atrapalha
// a leitura. A consulta só existe enquanto se espera o código ou a leitura, e para ao conectar.
const POLL_MS = 5000;
// Instalar e remover o serviço é trabalho do agente do servidor, que passa uma vez por minuto.
const SERVICE_POLL_MS = 15000;
const QR_SIZE = 264;
// Iguais em todo idioma: são comandos, não frases.
const RUN_AGENT = "bash install/agent.sh";
const RUN_UPDATE = "bash install/update.sh";
/** MB em GB com uma casa, no formato do idioma. */
const gigabytes = (megabytes: number, locale: string): string => (megabytes / 1024).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface ServiceData {
  available: boolean;
  service: "absent" | "preparing" | "running" | "failed" | "removing";
  serviceReason: "no_disk" | "pull_failed" | "start_failed" | "remove_failed" | null;
  serviceWarning: "low_memory" | "image_kept" | null;
  disk: { freeMb: number; neededMb: number } | null;
  agent: "responding" | "silent" | "never";
  status: "disconnected" | "starting" | "qr" | "connected" | "failed";
}

export interface ServiceTexts {
  unavailable: string;
  serviceAbsent: string;
  serviceCost: string;
  installService: string;
  servicePreparing: string;
  serviceFailed: Record<NonNullable<ServiceData["serviceReason"]> | "unknown", string>;
  noDisk: string;
  lowMemory: string;
  imageKept: string;
  serviceRetry: string;
  serviceRemoving: string;
  removeService: string;
  removeServiceConfirm: string;
  removeServiceYes: string;
  agentNever: string;
  agentSilent: string;
}

export interface QrTexts {
  qrTitle: string;
  steps: string[];
  qrAlt: string;
  qrRenew: string;
  qrBetween: string;
}

/** Consulta de novo enquanto se espera o código ou a leitura (curta), ou o agente do servidor (longa). */
export function useServicePolling(data: ServiceData | undefined, reload: () => void): void {
  const up = data?.available === true && data.service === "running";
  const interval = up && (data.status === "starting" || data.status === "qr") ? POLL_MS : data?.service === "preparing" || data?.service === "removing" || data?.service === "failed" ? SERVICE_POLL_MS : 0;
  useEffect(() => {
    if (interval === 0) return;
    // Aba em segundo plano não consulta: ninguém está olhando.
    const timer = setInterval(() => !document.hidden && reload(), interval);
    return () => clearInterval(timer);
  }, [interval, reload]);
}

/** A confirmação de remover o serviço, no lugar dos botões enquanto está aberta. */
export function RemovalConfirm({ t, busy, cancel, onYes, onCancel }: { t: ServiceTexts; busy: boolean; cancel: string; onYes(): void; onCancel(): void }) {
  return (
    <Notice tone="fail">
      <p className="max-w-prose">{t.removeServiceConfirm}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="danger" busy={busy} onClick={onYes}>
          {t.removeServiceYes}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </Notice>
  );
}

/**
 * Os estados do serviço no servidor: indisponível, não instalado, preparando, falhou, removendo e o
 * aviso de pouca memória. O que acontece com o serviço de pé (o número) é de cada bloco.
 */
export function ServiceStates({ data, t, risk, busy, removal, removeButton, onInstall }: { data: ServiceData; t: ServiceTexts; risk: ReactNode; busy: boolean; removal: ReactNode; removeButton: ReactNode; onInstall(): void }) {
  const locale = useLocale();
  const gb = (megabytes: number): string => gigabytes(megabytes, locale);
  // Quem instala e remove é o agente do servidor. Calado ou ausente, a tela diz e mostra o comando.
  const agent =
    data.agent === "responding" ? null : (
      <Notice tone="warn">
        <p className="max-w-prose">{data.agent === "never" ? t.agentNever : t.agentSilent}</p>
        <code className="data">{RUN_AGENT}</code>
      </Notice>
    );
  return (
    <>
      {!data.available ? (
        <Notice>
          <p className="max-w-prose">{t.unavailable}</p>
          <code className="data">{RUN_UPDATE}</code>
        </Notice>
      ) : null}

      {data.available && data.service === "absent" ? (
        <>
          <div className="grid max-w-prose gap-1">
            <p className="font-bold">{t.serviceAbsent}</p>
            <p className="text-muted">{t.serviceCost}</p>
          </div>
          {data.serviceWarning === "image_kept" ? (
            <Notice tone="warn">
              <p className="max-w-prose">{t.imageKept}</p>
              <code className="data">{RUN_AGENT}</code>
            </Notice>
          ) : null}
          {risk}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" busy={busy} onClick={onInstall}>
              {t.installService}
            </Button>
          </div>
        </>
      ) : null}

      {data.available && data.service === "preparing" ? (
        <>
          <Notice>{t.servicePreparing}</Notice>
          {agent}
          {removal ?? <div className="flex flex-wrap items-center gap-3">{removeButton}</div>}
        </>
      ) : null}

      {data.available && data.service === "failed" ? (
        <>
          <Notice tone="fail">
            <p className="max-w-prose">{data.disk ? fill(t.noDisk, { free: gb(data.disk.freeMb), needed: gb(data.disk.neededMb), missing: gb(data.disk.neededMb - data.disk.freeMb) }) : t.serviceFailed[data.serviceReason ?? "unknown"]}</p>
            <p className="max-w-prose">{t.serviceRetry}</p>
          </Notice>
          {agent}
          {removal ?? <div className="flex flex-wrap items-center gap-3">{removeButton}</div>}
        </>
      ) : null}

      {data.available && data.service === "removing" ? (
        <>
          <Notice>{t.serviceRemoving}</Notice>
          {agent}
        </>
      ) : null}

      {data.available && data.service === "running" && data.serviceWarning === "low_memory" ? <Notice tone="warn">{t.lowMemory}</Notice> : null}
    </>
  );
}

/** O QR Code com os passos ao lado. Fundo claro nos dois temas (token fixo): a câmera precisa do contraste. */
export function QrCodeBox({ qr, t }: { qr: string | null; t: QrTexts }) {
  return (
    <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
      <div className="grid place-items-center rounded-sm border border-line bg-qr-surface p-3 text-qr-ink" style={{ width: QR_SIZE, height: QR_SIZE }}>
        {qr ? <img src={qr} alt={t.qrAlt} width={QR_SIZE - 24} height={QR_SIZE - 24} /> : <span className="text-center text-[0.87rem]">{t.qrBetween}</span>}
      </div>
      <div className="grid gap-3">
        <h3 className="font-bold">{t.qrTitle}</h3>
        <ol className="grid max-w-prose list-decimal gap-1 pl-5">
          {t.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="max-w-prose text-muted">{t.qrRenew}</p>
      </div>
    </div>
  );
}
