/** Só o que a lateral usa da resposta de `GET /system/update`. */
export interface UpdateStatus {
  running: { version: string; updatable: boolean };
  published: { ok: true; latest: string | null; newer: Array<{ version: string }> } | { ok: false };
}

/**
 * O que a lateral mostra: a versão nova destacada, a versão em execução sem destaque, ou nada.
 *
 * O destaque só vai para quem pode pedir a atualização (`canUpdate`, a mesma regra que mostra o
 * botão na tela de versão). Para os outros papéis, um "Atualização disponível" seria um chamado
 * para uma ação que a tela recusa.
 */
export function updateNotice(status: UpdateStatus, canUpdate: boolean, showVersion: boolean): { version: string; newer: boolean } | null {
  const newer = canUpdate && status.running.updatable && status.published.ok && status.published.newer.length > 0;
  if (newer && status.published.ok && status.published.latest) return { version: status.published.latest, newer: true };
  return showVersion ? { version: status.running.version, newer: false } : null;
}
