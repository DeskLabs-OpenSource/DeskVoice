import type { ClaimedTask, Clock, Db } from "@deskvoice/core";
import type { WhatsAppDeps } from "@deskvoice/tools";

/** O que toda rotina recebe. `fetch`, `lookup` e `waha` existem para o teste não tocar a rede. */
export interface RoutineDeps extends WhatsAppDeps {
  db: Db;
  clock: Clock;
  /** Decifra os segredos de `settings`. */
  secretKey: Buffer;
  /** Pasta das gravações, para o prazo de guarda. Sem ela, as gravações não são apagadas por aqui. */
  recordingsDir?: string;
}

export interface Routine {
  /** O `tasks.kind` que esta rotina executa. */
  kind: string;
  /** Lançar erro devolve a tarefa à fila (até o limite de tentativas). Precisa ser seguro repetir. */
  run(task: ClaimedTask, deps: RoutineDeps): Promise<void>;
}
