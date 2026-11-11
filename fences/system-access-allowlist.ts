/**
 * Arquivos de produto, fora de `packages/core`, que podem usar `withSystem`.
 *
 * `withSystem` abre o banco com o papel que atravessa organizações. Cada uso é um lugar onde o
 * isolamento depende só do cuidado de quem escreveu a consulta, então cada um precisa de um
 * motivo que caiba numa linha. Não coube? A operação provavelmente deveria ser uma função de
 * `packages/core`, com teste de isolamento ao lado.
 */
export const SYSTEM_ACCESS_ALLOWLIST: Record<string, string> = {
  "apps/panel/src/app/api/v1/auth/login/route.ts": "acha o usuário pelo e-mail antes de existir sessão",
  "apps/panel/src/server/context.ts": "acha a sessão pelo hash do token antes de saber a organização",
  "apps/panel/src/app/api/v1/system/health/route.ts": "rota pública de saúde: não há sessão para abrir uma organização",
  "apps/panel/src/server/update.ts": "a atualização é da instalação: ouvir o agente e vencer pedido parado atravessam organizações",
  "apps/panel/scripts/seed-demo.ts": "semente da demonstração: cria a organização",
  "apps/routines/src/cli/create-owner.ts": "cria a organização e o primeiro usuário",
  "apps/routines/src/cli/reset-password.ts": "acha o usuário pelo e-mail, rodando só de dentro da VPS",
  "apps/routines/src/cli/migrate.ts": "define a senha dos papéis do banco com a conexão do dono",
  "apps/routines/src/runner.ts": "a fila atravessa organizações: devolve tarefa presa e acha a próxima agendada",
  "apps/voice/src/reconcile.ts": "na partida, fecha chamadas órfãs de qualquer organização que ficaram sem processo",
  "apps/voice/src/trunks.ts": "o arquivo de linhas do Asterisk reúne os troncos de todas as organizações",
};
