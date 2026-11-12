// dono: @DeskLabs-OpenSource/maintainers
// motivo: `postgres:17-alpine` e `caddy:2-alpine` eram etiquetas móveis no Compose de produção: a
//   instalação de amanhã baixava outra versão sem nada ter mudado no repositório, e duas
//   instalações "iguais" rodavam bancos diferentes. A base do `Dockerfile` (`node:22-alpine`) e o
//   Postgres dos jobs do CI tinham o mesmo defeito: cada versão publicada saía com o Node do dia, e
//   o CI testava contra um Postgres que não era o da produção.
// revisar em: 2027-05-11
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, jobs, listFiles, loadWorkflows, read } from "./_lib";

const COMPOSE = "deploy/docker-compose.yml";
// Resumo no fim do nome, direto ou como padrão de uma variável (`${VAR:-nome@sha256:...}`).
const PINNED = /@sha256:[0-9a-f]{64}\}?$/;

function checkCompose(root: string): string[] {
  if (!exists(root, COMPOSE)) return [`${COMPOSE}: não existe`];
  const violations: string[] = [];
  const services = asRecord(asRecord(parse(read(root, COMPOSE), { merge: true })).services);
  for (const [name, value] of Object.entries(services)) {
    const service = asRecord(value);
    // Serviço com `build` é imagem do próprio projeto: quem o guarda é image-name-has-one-source.
    if ("build" in service) continue;
    const image = typeof service.image === "string" ? service.image : "";
    if (!PINNED.test(image)) violations.push(`${COMPOSE}: a imagem de \`${name}\` (\`${image}\`) não está fixada por resumo`);
  }
  return violations;
}

/** A base de cada estágio. `FROM <estágio anterior>` e `FROM scratch` não baixam nada. */
function checkDockerfiles(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, ".", (f) => /(^|\/)Dockerfile(\.[^/]+)?$/.test(f))) {
    const stages = new Set(["scratch"]);
    for (const [index, line] of read(root, file).split("\n").entries()) {
      const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
      if (!from) continue;
      const image = from[1] ?? "";
      if (!stages.has(image.toLowerCase()) && !PINNED.test(image)) violations.push(`${file}:${index + 1}: a base \`${image}\` não está fixada por resumo`);
      if (from[2]) stages.add(from[2].toLowerCase());
    }
  }
  return violations;
}

/** Imagens que os jobs do CI baixam (`services` e `container`): o teste precisa rodar contra a versão da produção. */
function checkWorkflows(root: string): string[] {
  const violations: string[] = [];
  for (const { file, doc } of loadWorkflows(root)) {
    for (const [name, job] of jobs(doc)) {
      const containers: Array<[string, unknown]> = [
        ...Object.entries(asRecord(job.services)).map(([service, value]): [string, unknown] => [`services.${service}`, value]),
        ...("container" in job ? [["container", job.container] as [string, unknown]] : []),
      ];
      for (const [where, value] of containers) {
        const image = typeof value === "string" ? value : String(asRecord(value).image ?? "");
        if (!PINNED.test(image)) violations.push(`${file}: \`jobs.${name}.${where}\` usa \`${image}\`, sem resumo fixo`);
      }
    }
  }
  return violations;
}

const check = (root: string): string[] => [...checkCompose(root), ...checkDockerfiles(root), ...checkWorkflows(root)];

describe("third-party-images-are-pinned", () => {
  it("toda imagem de terceiros (Compose de produção, base dos Dockerfiles, jobs do CI) está fixada por resumo", () => {
    expectClean(
      check(REPO_ROOT),
      "Escreva a versão exata e o resumo: `nome:1.2.3-alpine@sha256:<resumo>`. O resumo sai de `docker buildx imagetools inspect nome:1.2.3-alpine` (linha Digest, a do índice multiarquitetura). Confira que a versão existe no registro antes de escrever.",
    );
  });

  it("reprova etiqueta móvel e versão exata sem resumo, aceita o resumo como padrão de variável e o estágio anterior como base", () => {
    expect(check(fixture("third-party-images-are-pinned"))).toEqual([
      "deploy/docker-compose.yml: a imagem de `postgres` (`postgres:17-alpine`) não está fixada por resumo",
      "deploy/docker-compose.yml: a imagem de `caddy` (`caddy:2.11.9-alpine`) não está fixada por resumo",
      "Dockerfile:1: a base `node:22-alpine` não está fixada por resumo",
      "Dockerfile:7: a base `node:22.23.5-alpine` não está fixada por resumo",
      "tools/Dockerfile.dev:1: a base `golang:1.25` não está fixada por resumo",
      ".github/workflows/ci.yml: `jobs.db.services.postgres` usa `postgres:17-alpine`, sem resumo fixo",
      ".github/workflows/ci.yml: `jobs.build.container` usa `node:22`, sem resumo fixo",
    ]);
  });
});
