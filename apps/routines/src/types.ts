import type { ClaimedTask, Clock, Db } from "@deskvoice/core";
import type { SafeFetchOptions } from "@deskvoice/tools";

/** O que toda rotina recebe. `fetch` e `lookup` existem para o teste não tocar a rede. */
export interface RoutineDeps extends SafeFetchOptions {
  db: Db;
  clock: Clock;
  /** Decifra os segredos de `settings`. */
  secretKey: Buffer;
}

export interface Routine {
  /** O `tasks.kind` que esta rotina executa. */
  kind: string;
  /** Lançar erro devolve a tarefa à fila (até o limite de tentativas). Precisa ser seguro repetir. */
  run(task: ClaimedTask, deps: RoutineDeps): Promise<void>;
}
