"use client";

import { ArrowCircleUp } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import en from "../i18n/en/common";
import es from "../i18n/es/common";
import { fill } from "../i18n/locales";
import ptBR from "../i18n/pt-BR/common";
import { useDict } from "../i18n/provider";
import { useApi } from "./api";
import { useCanConfigure } from "./me";
import { updateNotice, type UpdateStatus } from "./update-notice";

/** O agente do servidor confere as tags a cada 10 minutos: perguntar mais rápido repete a resposta. */
const REFRESH_MS = 600_000;

/**
 * Versão em execução e, quando há, a atualização esperando — na lateral, ao lado do estado do
 * sistema.
 *
 * A tela que atualiza sempre existiu (`/settings/system`), mas só era encontrada por quem já sabia
 * onde procurar: o sinal de "há versão nova" morava dentro dela. Aqui ele aparece em qualquer
 * página, sem ninguém abrir Configurações.
 *
 * Quem decide se há atualização é o servidor: `publishedReleases` compara a versão publicada com a
 * que está rodando e guarda o resultado por alguns minutos, então esta consulta não bate no GitHub
 * a cada página aberta. Instalação que roda versão não publicada (buildada no próprio servidor)
 * mostra a versão sem link: a tela de atualização recusa trocar o que não foi publicado, e prometer
 * o que a tela nega seria pior que não avisar.
 *
 * O destaque é só de quem pode atualizar (dono e administrador); os outros papéis veem a versão
 * em execução, sem o chamado para uma ação que a tela recusaria.
 *
 * `showVersion: false` é para onde o espaço é curto (o cabeçalho do celular): ali aparece só o
 * aviso, e só quando existe.
 */
export function UpdateIndicator({ showVersion = true }: { showVersion?: boolean }) {
  const t = useDict(ptBR, en, es).shell;
  const pathname = usePathname();
  const canUpdate = useCanConfigure();
  const { data, reload } = useApi<UpdateStatus>("/system/update");
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // Sem resposta da rota não há o que dizer: o silêncio é melhor que um aviso de erro num canto
  // da tela que ninguém abriu para ler sobre versão.
  if (!data) return null;

  const notice = updateNotice(data, canUpdate, showVersion);
  if (!notice) return null;
  const { version, newer } = notice;
  const label = fill(newer ? t.updateAvailable : t.versionShort, { version });

  return (
    <Link
      href="/settings/system"
      aria-current={pathname === "/settings/system" ? "page" : undefined}
      title={label}
      className={`flex h-9 min-w-0 items-center gap-2 rounded-xs px-2 text-[0.87rem] hover:bg-sunken hover:text-ink aria-[current=page]:bg-sunken aria-[current=page]:text-ink ${newer ? "font-medium text-accent" : "text-muted"}`}
    >
      {newer ? (
        <ArrowCircleUp size={16} weight="fill" className="shrink-0" aria-hidden />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-line-strong" aria-hidden />
      )}
      <span className="truncate">{label}</span>
    </Link>
  );
}
