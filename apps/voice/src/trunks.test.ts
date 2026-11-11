import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderTrunksConf, trunkProblem, writeFileAtomic, type TrunkConfig } from "./trunks";

const A = "0a000000-0000-4000-8000-000000000001";
const B = "0b000000-0000-4000-8000-000000000002";
const register: TrunkConfig = { id: A, host: "sip.operadora.example:5060", username: "conta100", password: "s3nha;com#simbolos[]", authMode: "register", publicIp: "203.0.113.10" };
const byIp: TrunkConfig = { id: B, host: "198.51.100.20", username: null, password: null, authMode: "ip", publicIp: null };

/** Nomes das seções do arquivo, como o Asterisk as leria: toda linha que começa com `[`. */
const sections = (conf: string): string[] => conf.split("\n").filter((line) => line.trimStart().startsWith("["));

describe("gerador de pjsip_trunks.conf", { timeout: 60_000 }, () => {
  it("modo register: endpoint, aor, identify, auth e registration, com as lições do Deskcomm", () => {
    expect(renderTrunksConf([register])).toEqual({
      skipped: [],
      conf: `; Gerado pelo DeskVoice a partir das linhas cadastradas no painel. Não edite: é reescrito a cada mudança.

[trunk-${A}]
type=endpoint
transport=transport-udp
context=from-trunk
disallow=all
allow=ulaw
allow=alaw
aors=trunk-${A}
outbound_auth=trunk-${A}-auth
from_user=conta100
from_domain=203.0.113.10
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes

[trunk-${A}]
type=aor
contact=sip:sip.operadora.example:5060
qualify_frequency=30

[trunk-${A}-identify]
type=identify
endpoint=trunk-${A}
match=sip.operadora.example

[trunk-${A}-auth]
type=auth
auth_type=userpass
username=conta100
password=s3nha\\;com#simbolos[]

[trunk-${A}-registration]
type=registration
transport=transport-udp
outbound_auth=trunk-${A}-auth
server_uri=sip:sip.operadora.example:5060
client_uri=sip:conta100@sip.operadora.example:5060
retry_interval=60
`,
    });
  });

  it("modo ip: sem auth, sem registration e sem from_domain quando não há IP público", () => {
    const { conf, skipped } = renderTrunksConf([byIp]);
    expect(skipped).toEqual([]);
    expect(sections(conf)).toEqual([`[trunk-${B}]`, `[trunk-${B}]`, `[trunk-${B}-identify]`]);
    expect(conf).toContain("contact=sip:198.51.100.20\n");
    expect(conf).toContain("match=198.51.100.20\n");
    expect(conf).not.toMatch(/auth|registration|from_domain|from_user/);
  });

  it("vários troncos saem em ordem estável, um conjunto de seções por tronco", () => {
    const { conf } = renderTrunksConf([byIp, register]);
    expect(sections(conf).map((line) => line.slice(7, 9))).toEqual(["0a", "0a", "0a", "0a", "0a", "0b", "0b", "0b"]);
    expect(renderTrunksConf([register, byIp]).conf).toBe(conf);
  });

  it("entrada maliciosa não injeta seção nem linha: o tronco fica de fora, com o motivo", () => {
    const evil = "\n[hacker]\ntype=endpoint\ncontext=default";
    const attacks: Array<Partial<TrunkConfig>> = [
      { host: `sip.example${evil}` },
      { host: "sip.example\r\n[x]" },
      { host: "sip.example;context=default" },
      { host: "[x]" },
      { host: "sip.example match=0.0.0.0/0" },
      { host: "" },
      { username: `conta${evil}` },
      { username: "conta]\n[x" },
      { username: "conta;x" },
      { username: "conta 100" },
      { password: `senha${evil}` },
      { password: "senha\r[x]" },
      { password: `senha${String.fromCharCode(0x2028)}[x]` },
      { password: "senha\u0000" },
      { password: ">senha" },
      { password: " senha" },
      { password: "x".repeat(129) },
      { id: `${A}]\n[x` },
      { username: null },
    ];
    for (const attack of attacks) {
      const trunk = { ...register, ...attack };
      const { conf, skipped } = renderTrunksConf([trunk, byIp]);
      expect(skipped, JSON.stringify(attack)).toEqual([{ id: trunk.id, reason: expect.any(String) }]);
      expect(trunkProblem(trunk)).not.toBeNull();
      // Só o tronco bom está no arquivo, e nenhuma linha dele veio do ataque.
      expect(conf, JSON.stringify(attack)).toBe(renderTrunksConf([byIp]).conf);
    }
  });

  it("senha com símbolos legítimos entra numa linha só, com o ponto e vírgula escapado", () => {
    const { conf, skipped } = renderTrunksConf([{ ...register, password: "[geral];#include x=>y" }]);
    expect(skipped).toEqual([]);
    expect(conf).toContain("\npassword=[geral]\\;#include x=>y\n");
    expect(sections(conf)).toHaveLength(5);
  });

  it("IP público malformado não entra no arquivo", () => {
    const { conf } = renderTrunksConf([{ ...register, publicIp: "203.0.113.10\n[x]" }]);
    expect(conf).not.toContain("from_domain");
    expect(sections(conf)).toHaveLength(5);
  });

  describe("escrita atômica", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "deskvoice-trunks-"));
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("cria a pasta, troca o arquivo inteiro e não deixa temporário para trás", async () => {
      const file = path.join(dir, "generated", "pjsip_trunks.conf");
      await writeFileAtomic(file, "primeiro\n");
      await writeFileAtomic(file, "segundo\n");
      expect(await readFile(file, "utf8")).toBe("segundo\n");
      expect(await readdir(path.dirname(file))).toEqual(["pjsip_trunks.conf"]);
    });

    it("se a troca falha, o arquivo anterior fica intacto e o temporário é removido", async () => {
      // O destino é uma pasta com conteúdo: o rename falha depois de o temporário já estar escrito.
      const target = path.join(dir, "ocupado");
      await writeFileAtomic(path.join(target, "dentro.conf"), "conteúdo\n");
      await writeFile(path.join(dir, "vizinho.conf"), "intacto\n");
      await expect(writeFileAtomic(target, "novo\n")).rejects.toThrow();
      expect((await readdir(dir)).sort()).toEqual(["generated", "ocupado", "vizinho.conf"]);
      expect(await readFile(path.join(target, "dentro.conf"), "utf8")).toBe("conteúdo\n");
    });
  });
});
