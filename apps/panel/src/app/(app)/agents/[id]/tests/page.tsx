"use client";

// O endereço antigo dos testes do agente (fatia 7c). Desde a fatia 1 das abas (desenho 2026-11-26,
// seção 4.4), os testes são a aba Testes da tela do agente: o favorito de quem já tinha continua abrindo.
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { Skeleton } from "../../../../../ui/kit";

export default function AgentTestsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  useEffect(() => {
    router.replace(`/agents/${id}?aba=testes`);
  }, [id, router]);
  return <Skeleton lines={6} />;
}
