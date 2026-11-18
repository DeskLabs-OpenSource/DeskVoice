"use client";

import en from "../../../../i18n/en/installation";
import es from "../../../../i18n/es/installation";
import ptBR from "../../../../i18n/pt-BR/installation";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { Panel, Skeleton } from "../../../../ui/kit";
import { OverviewRow, type OverviewRowView } from "./row";

interface Overview {
  voiceAnswered: boolean;
  organizations: OverviewRowView[];
}

/**
 * A visão geral da instalação (seção 3.7 do desenho do R8): uma linha por organização (`OverviewRow`),
 * com os números que a tela de cada uma mostra. Só de leitura e sem exportação.
 */
export default function InstallationOverview() {
  const t = useDict(ptBR, en, es).overview;
  const { data } = useApi<Overview>("/installation/overview");
  return (
    <Panel title={t.title} description={t.lead}>
      {!data ? (
        <Skeleton />
      ) : data.organizations.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <ul className="grid">
          {data.organizations.map((row) => (
            <OverviewRow key={row.id} row={row} t={t} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
