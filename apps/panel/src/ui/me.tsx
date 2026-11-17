"use client";

import { createContext, useContext } from "react";
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
 * Onde mora a tela de atualizar: nas Configurações enquanto a lista de quem administra a instalação
 * não é explícita, e na área da instalação depois (seção 3.11). `null`: esta pessoa não tem acesso a ela.
 */
export function updatePath(me: Me | null): string | null {
  if (!me?.installationExplicit) return "/settings/system";
  return me.installationAdmin ? "/installation/update" : null;
}
