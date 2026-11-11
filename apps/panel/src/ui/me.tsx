"use client";

import { createContext, useContext } from "react";
import type { Me } from "./types";

export const MeContext = createContext<Me | null>(null);

/** Se quem está na tela pode alterar configuração. A API confere de novo; isto só evita o botão que falharia. */
export const useCanConfigure = (): boolean => useContext(MeContext)?.role !== "operator";

/** Quem está na tela, para as regras que dependem do papel (o que oferecer na tela de equipe). */
export const useMe = (): Me | null => useContext(MeContext);
