"use client";

import { createContext, useContext } from "react";
import { useApi } from "./api";
import type { Me } from "./types";

export const MeContext = createContext<Me | null>(null);

/** Se quem está na tela pode alterar configuração. A API confere de novo; isto só evita o botão que falharia. */
export const useCanConfigure = (): boolean => useContext(MeContext)?.role !== "operator";

/** Quem está na tela, para as regras que dependem do papel (o que oferecer na tela de equipe). */
export const useMe = (): Me | null => useContext(MeContext);

/**
 * Se quem está na tela administra a instalação: é quem vê "Administrar a instalação" e o botão de
 * atualizar. A API confere de novo.
 */
export const useInstallationAdmin = (): boolean => useContext(MeContext)?.installationAdmin === true;

/**
 * Onde mora a tela de atualizar: só na área da instalação, com a lista de quem a administra explícita
 * ou não (central de configuração, parte 8). `null`: esta pessoa não administra a instalação, e o
 * indicador mostra a versão sem link.
 */
export function updatePath(me: Me | null): string | null {
  return me?.installationAdmin ? "/installation/update" : null;
}

/** Uma organização em que a conta tem vínculo ativo (`GET /auth/organizations`). */
export interface Membership {
  organizationId: string;
  organizationName: string;
  current: boolean;
}

/**
 * As organizações para o seletor do topo, ou `null` quando ele não aparece: com um vínculo ativo só
 * (o caso de quase todo mundo), enquanto a lista carrega e se ela falhar. Quem tem um cliente só
 * não vê nada novo.
 */
export function useOrganizationChoices(): Membership[] | null {
  const { data } = useApi<Membership[]>("/auth/organizations");
  return data && data.length > 1 ? data : null;
}
