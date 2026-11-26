// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { StreamingTranscriber } from "@deskvoice/voice-engine/types";

/**
 * As peças de transcrição da pasta. `loadTranscribers()` lê a pasta em tempo de execução, e no pacote
 * do Next ela não existe (o mesmo motivo de `pieces.ts`, `brains.ts` e `synthesizers.ts`): a descoberta
 * é a mesma, por pasta, resolvida pelo empacotador. Um teste confere que as duas acham as mesmas peças.
 */
const transcriberModules = import.meta.glob<{ default: StreamingTranscriber }>([
  "../../../../packages/voice-engine/src/transcribers/*.ts",
  "!../../../../packages/voice-engine/src/transcribers/*.test.ts",
]);

let transcribers: Promise<StreamingTranscriber[]> | undefined;

export function listTranscribers(): Promise<StreamingTranscriber[]> {
  return (transcribers ??= Promise.all(Object.values(transcriberModules).map(async (load) => (await load()).default)));
}
