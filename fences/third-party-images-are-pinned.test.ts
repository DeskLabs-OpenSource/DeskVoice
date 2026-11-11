// dono: @DeskLabs-OpenSource/maintainers
// motivo: `postgres:17-alpine` e `caddy:2-alpine` eram etiquetas móveis no Compose de produção: a
//   instalação de amanhã baixava outra versão sem nada ter mudado no repositório, e duas
//   instalações "iguais" rodavam bancos diferentes.
// revisar em: 2027-05-11
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, read } from "./_lib";

const COMPOSE = "deploy/docker-compose.yml";
// Resumo no fim do nome, direto ou como padrão de uma variável (`${VAR:-nome@sha256:...}`).
const PINNED = /@sha256:[0-9a-f]{64}\}?$/;

function check(root: string): string[] {
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

describe("third-party-images-are-pinned", () => {
  it("toda imagem de terceiros do Compose de produção está fixada por resumo", () => {
    expectClean(
      check(REPO_ROOT),
      "Escreva a versão exata e o resumo: `nome:1.2.3-alpine@sha256:<resumo>`. O resumo sai de `docker buildx imagetools inspect nome:1.2.3-alpine` (linha Digest). Confira que a versão existe no registro antes de escrever.",
    );
  });

  it("reprova etiqueta móvel e versão exata sem resumo, e aceita o resumo como padrão de variável", () => {
    expect(check(fixture("third-party-images-are-pinned"))).toEqual([
      "deploy/docker-compose.yml: a imagem de `postgres` (`postgres:17-alpine`) não está fixada por resumo",
      "deploy/docker-compose.yml: a imagem de `caddy` (`caddy:2.11.9-alpine`) não está fixada por resumo",
    ]);
  });
});
