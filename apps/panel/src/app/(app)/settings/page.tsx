"use client";

import callsEn from "../../../i18n/en/calls";
import en from "../../../i18n/en/settings";
import callsEs from "../../../i18n/es/calls";
import es from "../../../i18n/es/settings";
import callsPtBR from "../../../i18n/pt-BR/calls";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { engineReady, firstStepsPending } from "../../../ui/first-steps";
import { useCanConfigure } from "../../../ui/me";
import type { Agent, Engine, Setting, Trunk } from "../../../ui/types";
import { SettingsHub } from "./hub";
import { enginesState, webhooksState, whatsappState } from "./hub-state";
import type { ServiceData } from "./optional-service";

/**
 * A central de Configurações (parte 3 do desenho da central de configuração). Uma leitura por área,
 * sempre de uma rota `GET` que a tela da área já chama: nenhuma rota nova. A leitura de `/engines`
 * serve o cartão de Motores de voz e o passo da chave.
 */
export default function Settings() {
  const t = useDict(ptBR, en, es);
  const calls = useDict(callsPtBR, callsEn, callsEs);
  const canConfigure = useCanConfigure();
  const agents = useApi<Agent[]>("/agents");
  const trunks = useApi<Trunk[]>("/trunks");
  const engines = useApi<Engine[]>("/engines");
  // Como no bloco do WhatsApp: só quem configura lê o estado da conexão.
  const whatsapp = useApi<Pick<ServiceData, "available" | "service" | "status">>(canConfigure ? "/whatsapp" : null);
  const webhooks = useApi<Setting<unknown[]>>("/settings/webhooks.allowed");
  return (
    <SettingsHub
      t={t.hub}
      steps={calls.empty}
      view={{
        steps: firstStepsPending({ agents: agents.data, trunks: trunks.data, engines: engines.data }),
        engines: enginesState(engineReady(engines.data)),
        whatsapp: canConfigure ? whatsappState(whatsapp.data) : null,
        webhooks: webhooksState(webhooks.data?.value, webhooks.data !== undefined),
      }}
    />
  );
}
