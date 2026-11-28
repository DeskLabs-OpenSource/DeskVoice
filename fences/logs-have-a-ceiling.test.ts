// dono: @DeskLabs-OpenSource/maintainers
// motivo: o Asterisk gravava /var/log/asterisk/messages.log (o padrão da imagem) sem teto nem
//   rotação. Numa instalação de teste o arquivo chegou a 20 GB em duas semanas e o disco a 97%;
//   noutra, 9,7 GB. O log só tem teto quando sai pela saída do contêiner, que o Docker limita pelo `logging` do Compose.
// revisar em: 2027-05-26
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, read } from "./_lib";

const COMPOSE = "deploy/docker-compose.yml";
const LOGGER = "deploy/asterisk/logger.conf";
const LOGGER_MOUNT = "./asterisk/generated/logger.conf:/etc/asterisk/logger.conf:ro";
// O console vai para a saída do contêiner; o syslog sai dele. Qualquer outro nome é arquivo.
const NO_FILE = /^(console|syslog(\.\w+)?)$/;

function checkCompose(root: string): string[] {
  if (!exists(root, COMPOSE)) return [`${COMPOSE}: não existe`];
  const violations: string[] = [];
  const services = asRecord(asRecord(parse(read(root, COMPOSE), { merge: true })).services);
  for (const [name, value] of Object.entries(services)) {
    const service = asRecord(value);
    const logging = asRecord(service.logging);
    const options = asRecord(logging.options);
    if (!["json-file", "local"].includes(String(logging.driver)) || !options["max-size"] || !options["max-file"]) {
      violations.push(`${COMPOSE}: \`${name}\` não tem \`logging\` com driver json-file (ou local), max-size e max-file`);
    }
  }
  const volumes = asRecord(services.asterisk).volumes;
  if (!Array.isArray(volumes) || !volumes.includes(LOGGER_MOUNT)) {
    violations.push(`${COMPOSE}: o \`asterisk\` não monta \`${LOGGER_MOUNT}\` (sem ele vale o logger.conf da imagem, que grava messages.log)`);
  }
  return violations;
}

function checkLogger(root: string): string[] {
  if (!exists(root, LOGGER)) return [`${LOGGER}: não existe`];
  const violations: string[] = [];
  let section = "";
  for (const [index, raw] of read(root, LOGGER).split("\n").entries()) {
    const line = raw.replace(/;.*/, "").trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) section = header[1] ?? "";
    else if (section === "logfiles" && line) {
      const channel = line.split(/\s*=>?\s*/)[0] ?? "";
      if (!NO_FILE.test(channel)) violations.push(`${LOGGER}:${index + 1}: o canal \`${channel}\` grava em arquivo dentro do contêiner, sem teto`);
    }
  }
  return violations;
}

const check = (root: string): string[] => [...checkCompose(root), ...checkLogger(root)];

describe("logs-have-a-ceiling", () => {
  it("todo log da instalação tem teto: o Docker limita cada serviço, e o Asterisk não grava arquivo", () => {
    expectClean(
      check(REPO_ROOT),
      "Todo serviço do Compose de produção usa `logging: *logging` (json-file com max-size e max-file). O Asterisk escreve só no console (`console => ...` em deploy/asterisk/logger.conf), que é a saída do contêiner; um canal em arquivo cresce sem limite.",
    );
  });

  it("reprova serviço sem teto, o Asterisk sem o logger.conf do kit e canal em arquivo; aceita console e syslog", () => {
    expect(check(fixture("logs-have-a-ceiling"))).toEqual([
      "deploy/docker-compose.yml: `voice` não tem `logging` com driver json-file (ou local), max-size e max-file",
      "deploy/docker-compose.yml: `routines` não tem `logging` com driver json-file (ou local), max-size e max-file",
      "deploy/docker-compose.yml: `asterisk` não tem `logging` com driver json-file (ou local), max-size e max-file",
      "deploy/docker-compose.yml: o `asterisk` não monta `./asterisk/generated/logger.conf:/etc/asterisk/logger.conf:ro` (sem ele vale o logger.conf da imagem, que grava messages.log)",
      "deploy/asterisk/logger.conf:8: o canal `messages.log` grava em arquivo dentro do contêiner, sem teto",
      "deploy/asterisk/logger.conf:9: o canal `security` grava em arquivo dentro do contêiner, sem teto",
    ]);
  });
});
