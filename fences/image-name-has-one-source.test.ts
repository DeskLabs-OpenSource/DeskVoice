// dono: @DeskLabs-OpenSource/maintainers
// motivo: o endereço das imagens estava escrito no workflow de publicação, no kit e no Compose, e
//   o formato da versão divergia (X.Y.Z no CI, vX.Y.Z no atualizador): a atualização nunca achava
//   a imagem e construía na VPS. A instalação também gravava o canal `stable` em vez do número.
// revisar em: 2027-05-11
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, listFiles, read } from "./_lib";

const SOURCE = "deploy/images.env";
const COMPOSE = "deploy/docker-compose.yml";
const PUBLISH = ".github/workflows/publish-image.yml";
// Os três lados que usam o endereço: quem publica, quem instala e o que o Compose pede.
const SIDES = [".github", "install", "deploy"];
const isText = (file: string): boolean => !/\.(png|jpe?g|gif|ico|webp|ulaw|wav|gz|zip)$/i.test(file);

function check(root: string): string[] {
  if (!exists(root, SOURCE)) return [`${SOURCE}: não existe`];
  const prefix = /^DESKVOICE_IMAGE_PREFIX=(\S+)$/m.exec(read(root, SOURCE))?.[1];
  if (!prefix) return [`${SOURCE}: sem uma linha DESKVOICE_IMAGE_PREFIX=<endereço>`];
  const violations: string[] = [];
  for (const dir of SIDES) {
    for (const file of listFiles(root, dir, isText)) {
      const text = read(root, file);
      // O WaCalls do fork mora no mesmo registro, mas não é imagem do DeskVoice: vai fixado por
      // resumo, e um fork do DeskVoice que troca o prefixo continua baixando o mesmo WaCalls.
      const own = text.replaceAll(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wacalls@sha256:[0-9a-f]{64}`, "g"), "");
      if (file !== SOURCE && own.includes(prefix)) violations.push(`${file}: repete \`${prefix}\`, que só pode estar em ${SOURCE}`);
      // Canal não é versão: nem padrão do Compose, nem valor gravado pelo kit. Os testes do kit
      // ficam de fora: eles montam de propósito a instalação antiga, que gravava o canal.
      if (!file.startsWith("install/test/") && /DESKVOICE_VERSION[^\n]*\bstable\b/.test(text)) violations.push(`${file}: usa o canal \`stable\` como versão da instalação`);
    }
  }
  if (exists(root, COMPOSE)) {
    const services = asRecord(asRecord(parse(read(root, COMPOSE), { merge: true })).services);
    for (const [name, value] of Object.entries(services)) {
      const service = asRecord(value);
      const target = asRecord(service.build).target;
      if (typeof target !== "string") continue;
      const wanted = `\${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-${target}:\${DESKVOICE_VERSION:-dev}`;
      if (service.image !== wanted) violations.push(`${COMPOSE}: a imagem de \`${name}\` é \`${String(service.image)}\`; deveria ser \`${wanted}\``);
    }
  }
  if (exists(root, PUBLISH) && /\/deskvoice-/.test(read(root, PUBLISH))) {
    violations.push(`${PUBLISH}: monta o nome da imagem à mão; use \`image_ref\`, de install/_common.sh`);
  }
  return violations;
}

describe("image-name-has-one-source", () => {
  it("o endereço das imagens e o formato da versão têm uma fonte só", () => {
    expectClean(
      check(REPO_ROOT),
      "O endereço das imagens mora só em deploy/images.env. No kit e no workflow, monte o nome com `image_ref <processo> <versão>` (install/_common.sh); no Compose, use `${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-<alvo>:${DESKVOICE_VERSION:-dev}`. A versão gravada é sempre um número X.Y.Z (ou `local`), nunca um canal.",
    );
  });

  it("reprova segunda cópia do endereço, canal como versão, imagem fora do formato e nome montado à mão", () => {
    expect(check(fixture("image-name-has-one-source"))).toEqual([
      ".github/workflows/publish-image.yml: repete `registro.example/projeto`, que só pode estar em deploy/images.env",
      "install/_common.sh: repete `registro.example/projeto`, que só pode estar em deploy/images.env",
      "install/_common.sh: usa o canal `stable` como versão da instalação",
      "deploy/docker-compose.yml: repete `registro.example/projeto`, que só pode estar em deploy/images.env",
      "deploy/docker-compose.yml: usa o canal `stable` como versão da instalação",
      // O WaCalls por etiqueta reprova; o fixado por resumo (install/wacalls-pinned.sh) passa.
      "deploy/wacalls-tag.yml: repete `registro.example/projeto`, que só pode estar em deploy/images.env",
      "deploy/docker-compose.yml: a imagem de `panel` é `${DESKVOICE_IMAGE_PREFIX:-registro.example/projeto}/deskvoice-panel:${DESKVOICE_VERSION:-stable}`; deveria ser `${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-panel:${DESKVOICE_VERSION:-dev}`",
      "deploy/docker-compose.yml: a imagem de `voice` é `${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-voz:${DESKVOICE_VERSION:-dev}`; deveria ser `${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-voice:${DESKVOICE_VERSION:-dev}`",
      ".github/workflows/publish-image.yml: monta o nome da imagem à mão; use `image_ref`, de install/_common.sh",
    ]);
  });

  it("reprova a fonte ausente", () => {
    expect(check(fixture("docs-point-to-existing-files"))).toEqual(["deploy/images.env: não existe"]);
  });
});
