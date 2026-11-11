import { createDb, loadConfig, systemClock } from "@deskvoice/core";
import { loadRoutines } from "./load";
import { createLogger } from "./log";
import { startRunner } from "./runner";

const log = createLogger(systemClock);
const config = loadConfig(process.env);
const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
const routines = await loadRoutines();

const runner = await startRunner({
  db,
  clock: systemClock,
  secretKey: config.secretKey,
  routines,
  log,
  onFatal: (error) => {
    // Sem a escuta o runner não acorda mais; sair deixa o orquestrador subir um processo são.
    log("error", "queue listener lost; exiting", { error: error.message });
    process.exit(1);
  },
});
log("info", "routines runner started", { routines: [...routines.keys()] });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  await runner.close();
  await db.close();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
