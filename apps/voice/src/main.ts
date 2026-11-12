import { createDb, loadConfig, systemClock } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { loadEngines } from "@deskvoice/voice-engine";
import { createAriClient } from "./ari";
import { createLogger, messageOf } from "./log";
import { startVoiceServer } from "./server";
import { DEFAULT_TRUNKS_FILE } from "./trunks";
import { DEFAULT_RECORDINGS_DIR } from "@deskvoice/core";

const log = createLogger(systemClock);
const config = loadConfig(process.env);
const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
const [engines, tools] = await Promise.all([loadEngines(), loadTools()]);

const ari = createAriClient({ url: config.ariUrl, app: config.ariApp, username: config.ariUsername, password: config.ariPassword, log });
const server = await startVoiceServer({
  db,
  clock: systemClock,
  engines,
  tools,
  ari,
  secretKey: config.secretKey,
  audioSocketPort: config.audioSocketPort,
  internalPort: Number(process.env.VOICE_INTERNAL_PORT ?? 8090),
  webPort: Number(process.env.VOICE_WEB_PORT ?? 8091),
  internalToken: process.env.INTERNAL_TOKEN,
  trunksFile: process.env.ASTERISK_TRUNKS_FILE ?? DEFAULT_TRUNKS_FILE,
  recordingsDir: process.env.RECORDINGS_DIR ?? DEFAULT_RECORDINGS_DIR,
  publicIp: process.env.PUBLIC_IP ?? null,
  // A imagem do Asterisk roda como uid e gid 1000; o arquivo de troncos precisa ser dele.
  trunksOwner: { uid: Number(process.env.ASTERISK_UID ?? 1000), gid: Number(process.env.ASTERISK_GID ?? 1000) },
  log,
});
// Sem Asterisk no ar o processo não morre: a escuta fica tentando, a saúde diz `fail` com o
// motivo, e a chamada simulada funciona assim mesmo.
ari.start();
log("info", "voice process started", { audioSocketPort: server.audioSocketPort, internalPort: server.internalPort, webPort: server.webPort, engines: [...engines.keys()], tools: [...tools.keys()] });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  try {
    await server.close();
    await db.close();
  } catch (error) {
    log("error", "shutdown failed", { error: messageOf(error) });
    process.exitCode = 1;
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
