import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTrunkHost } from "./trunk-host";
import { NAME_IN_IP_MODE_REASON, renderTrunksConf, SHARED_HOST_REASON, trunkProblem, writeFileAtomic, type TrunkConfig } from "./trunks";

const A = "0a000000-0000-4000-8000-000000000001";
const B = "0b000000-0000-4000-8000-000000000002";
const C = "0c000000-0000-4000-8000-000000000003";
const ORG1 = "10000000-0000-4000-8000-00000000000a";
const ORG2 = "20000000-0000-4000-8000-00000000000b";
const register: TrunkConfig = { id: A, host: "sip.operadora.example:5060", username: "conta100", password: "s3nha;com#simbolos[]", authMode: "register", publicIp: "203.0.113.10", organizationId: ORG1 };
const byIp: TrunkConfig = { id: B, host: "198.51.100.20", username: null, password: null, authMode: "ip", publicIp: null, organizationId: ORG1 };

/** Nomes das seções do arquivo, como o Asterisk as leria: toda linha que começa com `[`. */
const sections = (conf: string): string[] => conf.split("\n").filter((line) => line.trimStart().startsWith("["));
/** Tudo o que o arquivo tem de um tronco: os blocos cujo nome começa com `trunk-<id>`. */
const blocksOf = (conf: string, id: string): string => conf.split("\n\n").map((block) => block.trim()).filter((block) => block.startsWith(`[trunk-${id}`)).join("\n\n");
const identifies = (conf: string): string[] => conf.split("\n").filter((line) => line.startsWith("match="));

describe("gerador de pjsip_trunks.conf", { timeout: 60_000 }, () => {
  it("modo register com nome no host: endpoint, aor, auth e registration com line; sem identify, porque nome não se compara", () => {
    expect(renderTrunksConf([register])).toEqual({
      skipped: [],
      emitted: [A],
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
line=yes
endpoint=trunk-${A}
retry_interval=60
`,
    });
  });

  it("modo register com IP exclusivo: line no registro e identify pelo endereço", () => {
    const { conf, skipped } = renderTrunksConf([{ ...register, host: "198.51.100.30:5080" }]);
    expect(skipped).toEqual([]);
    expect(sections(conf)).toEqual([`[trunk-${A}]`, `[trunk-${A}]`, `[trunk-${A}-identify]`, `[trunk-${A}-auth]`, `[trunk-${A}-registration]`]);
    expect(conf).toContain(`[trunk-${A}-identify]\ntype=identify\nendpoint=trunk-${A}\nmatch=198.51.100.30\n`);
    expect(conf).toContain(`line=yes\nendpoint=trunk-${A}\n`);
    expect(conf).toContain("server_uri=sip:198.51.100.30:5080\n");
  });

  it("modo ip: sem auth, sem registration e sem from_domain quando não há IP público", () => {
    const { conf, skipped } = renderTrunksConf([byIp]);
    expect(skipped).toEqual([]);
    expect(sections(conf)).toEqual([`[trunk-${B}]`, `[trunk-${B}]`, `[trunk-${B}-identify]`]);
    expect(conf).toContain("contact=sip:198.51.100.20\n");
    expect(conf).toContain("match=198.51.100.20\n");
    expect(conf).not.toMatch(/auth|registration|from_domain|from_user/);
  });

  it("modo ip com bloco de endereços: identify pelo bloco, e sem contato (a linha só recebe)", () => {
    const { conf, skipped } = renderTrunksConf([{ ...byIp, host: "198.51.100.77/24" }]);
    expect(skipped).toEqual([]);
    expect(conf).toContain("match=198.51.100.0/24\n");
    expect(conf).not.toMatch(/^contact=/m);
    // Registrar pede um servidor, não um bloco.
    expect(renderTrunksConf([{ ...register, host: "198.51.100.0/24" }]).skipped).toEqual([{ id: A, reason: expect.stringContaining("address block") }]);
  });

  it("modo ip com nome no host: não é emitido, e a mensagem manda usar o endereço numérico ou o registro", () => {
    for (const host of ["sip.operadora.example", "sip.operadora.example:5060", "provedor"]) {
      const { conf, skipped } = renderTrunksConf([{ ...byIp, host }, register]);
      expect(skipped, host).toEqual([{ id: B, reason: NAME_IN_IP_MODE_REASON }]);
      expect(conf).not.toContain(B);
    }
    expect(NAME_IN_IP_MODE_REASON).toMatch(/numeric address.*not a name.*registration/);
  });

  it("nome nunca gera identify, em nenhum modo, nem quando é exclusivo", () => {
    expect(identifies(renderTrunksConf([register]).conf)).toEqual([]);
    expect(identifies(renderTrunksConf([register, { ...register, id: C, host: "outra.operadora.example" }]).conf)).toEqual([]);
  });

  it("vários troncos saem em ordem de id, estável, seja qual for a ordem de entrada", () => {
    const { conf } = renderTrunksConf([byIp, register]);
    expect(sections(conf).map((line) => line.slice(7, 9))).toEqual(["0a", "0a", "0a", "0a", "0b", "0b", "0b"]);
    expect(renderTrunksConf([register, byIp]).conf).toBe(conf);
  });

  describe("endereços que se sobrepõem", () => {
    const elsewhere = (trunk: TrunkConfig, id = C): TrunkConfig => ({ ...trunk, id, organizationId: ORG2 });

    it("dois ip no mesmo endereço em organizações diferentes: nenhum é emitido, os dois ficam com o erro", () => {
      const { conf, skipped } = renderTrunksConf([byIp, elsewhere(byIp), register]);
      expect(skipped).toEqual([{ id: B, reason: SHARED_HOST_REASON }, { id: C, reason: SHARED_HOST_REASON }]);
      expect(conf).toBe(renderTrunksConf([register]).conf);
      expect(identifies(conf)).toEqual([]);
    });

    it("dois ip no mesmo endereço na MESMA organização: o de menor id sai com identify, o outro fica de fora", () => {
      for (const input of [[byIp, { ...byIp, id: C }], [{ ...byIp, id: C }, byIp]]) {
        const { conf, skipped } = renderTrunksConf(input);
        expect(skipped).toEqual([{ id: C, reason: SHARED_HOST_REASON }]);
        expect(conf).toBe(renderTrunksConf([byIp]).conf);
        expect(identifies(conf)).toEqual(["match=198.51.100.20"]);
      }
    });

    it("register e ip em organizações diferentes no mesmo endereço: o register sai sem identify, o ip não sai", () => {
      const owner: TrunkConfig = { ...register, host: "198.51.100.30" };
      const { conf, skipped } = renderTrunksConf([owner, elsewhere({ ...byIp, host: "198.51.100.30:5080" })]);
      expect(skipped).toEqual([{ id: C, reason: SHARED_HOST_REASON }]);
      expect(conf).not.toContain(C);
      expect(identifies(conf)).toEqual([]);
      expect(blocksOf(conf, A)).toContain(`line=yes\nendpoint=trunk-${A}\n`);
    });

    it("dois register em organizações diferentes no mesmo IP: os dois saem, cada um com line e endpoint próprios, nenhum com identify", () => {
      const first: TrunkConfig = { ...register, host: "198.51.100.30" };
      const second = elsewhere({ ...register, host: "198.51.100.30", username: "conta999", password: "outra-senha" });
      const { conf, skipped } = renderTrunksConf([first, second]);
      expect(skipped).toEqual([]);
      expect(identifies(conf)).toEqual([]);
      for (const id of [A, C]) {
        expect(blocksOf(conf, id)).toContain(`line=yes\nendpoint=trunk-${id}\n`);
        expect(blocksOf(conf, id).match(/\nendpoint=/g)).toHaveLength(1);
      }
    });

    it("register e ip na mesma organização no mesmo endereço: o de menor id fica com o identify", () => {
      const sameOrgIp: TrunkConfig = { ...byIp, id: C, host: "198.51.100.30" };
      const { conf, skipped } = renderTrunksConf([{ ...register, host: "198.51.100.30" }, sameOrgIp]);
      expect(skipped).toEqual([{ id: C, reason: SHARED_HOST_REASON }]);
      expect(identifies(conf)).toEqual(["match=198.51.100.30"]);
      expect(blocksOf(conf, A)).toContain("type=identify");
    });

    it("bloco de uma organização sobreposto ao IP de outra: vale a regra de organizações diferentes", () => {
      for (const [mine, theirs] of [["203.0.113.0/24", "203.0.113.7"], ["203.0.113.7", "203.0.113.0/24"], ["203.0.113.0/24", "203.0.113.128/25"]]) {
        const { conf, skipped } = renderTrunksConf([{ ...byIp, host: mine ?? "" }, elsewhere({ ...byIp, host: theirs ?? "" })]);
        expect(skipped.map((entry) => entry.id), `${mine} x ${theirs}`).toEqual([B, C]);
        expect(identifies(conf)).toEqual([]);
      }
    });

    it("um bloco liga endereços que não se tocam: o grupo inteiro segue a regra", () => {
      // Dois IPs da ORG1, que sozinhos não conflitam, e um bloco da ORG2 que contém os dois.
      const second: TrunkConfig = { ...byIp, id: A, host: "198.51.100.21" };
      expect(renderTrunksConf([byIp, second]).skipped).toEqual([]);
      const { conf, skipped } = renderTrunksConf([byIp, second, elsewhere({ ...byIp, host: "198.51.100.0/24" })]);
      expect(skipped.map((entry) => entry.id)).toEqual([A, B, C]);
      expect(identifies(conf)).toEqual([]);
    });

    it("grafias diferentes do mesmo endereço são o mesmo endereço", () => {
      const same: Array<[string, string]> = [
        ["192.168.1.10", "192.168.001.010"],
        ["203.0.113.5", "::ffff:203.0.113.5"],
        ["203.0.113.5", "[::FFFF:cb00:7105]:5060"],
        ["203.0.113.5:5060", "203.0.113.5:5080"],
        ["2001:db8::1", "2001:0DB8:0000:0000:0000:0000:0000:0001"],
        ["2001:db8::1", "[2001:db8:0:0::1]:5060"],
        ["2001:db8::/32", "2001:db8:ffff::1"],
        ["::ffff:203.0.113.0/120", "203.0.113.200"],
      ];
      for (const [first, second] of same) {
        const { conf, skipped } = renderTrunksConf([{ ...byIp, host: first }, elsewhere({ ...byIp, host: second })]);
        expect(skipped.map((entry) => entry.id), `${first} x ${second}`).toEqual([B, C]);
        expect(identifies(conf)).toEqual([]);
      }
    });

    it("endereços diferentes não se confundem, nem entre organizações", () => {
      const different: Array<[string, string]> = [
        ["192.168.1.10", "192.168.1.100"],
        ["203.0.113.0/24", "203.0.114.1"],
        ["203.0.113.0/25", "203.0.113.128/25"],
        ["2001:db8::1", "2001:db8::2"],
        ["203.0.113.5", "::203.0.113.5"],
      ];
      for (const [first, second] of different) {
        const { conf, skipped } = renderTrunksConf([{ ...byIp, host: first }, elsewhere({ ...byIp, host: second })]);
        expect(skipped, `${first} x ${second}`).toEqual([]);
        expect(identifies(conf)).toHaveLength(2);
      }
    });

    it("o endereço vai para o arquivo na forma canônica, não na que foi digitada", () => {
      const written = (host: string): string[] => renderTrunksConf([{ ...byIp, host }]).conf.split("\n").filter((line) => /^(match|contact)=/.test(line));
      expect(written("192.168.001.010")).toEqual(["contact=sip:192.168.1.10", "match=192.168.1.10"]);
      expect(written("::ffff:203.0.113.5")).toEqual(["contact=sip:203.0.113.5", "match=203.0.113.5"]);
      expect(written("2001:0DB8:0000:0000:0000:0000:0000:0001")).toEqual(["contact=sip:[2001:db8::1]", "match=2001:db8::1"]);
      expect(written("[2001:DB8::1]:5080")).toEqual(["contact=sip:[2001:db8::1]:5080", "match=2001:db8::1"]);
      expect(written("203.000.113.077/024")).toEqual(["match=203.0.113.0/24"]);
      expect(written("2001:DB8:0:0:8:FFFF::/80")).toEqual(["match=2001:db8:0:0:8::/80"]);
    });

    it("dois register com o mesmo nome de host: nome não forma grupo; nenhum identify, cada registro com line e endpoint", () => {
      const other = elsewhere({ ...register, host: "SIP.Operadora.Example", username: "conta999", password: "outra-senha" });
      const { conf, skipped } = renderTrunksConf([register, other]);
      expect(skipped).toEqual([]);
      expect(conf).not.toMatch(/type=identify|match=/);
      for (const id of [A, C]) expect(blocksOf(conf, id)).toContain(`line=yes\nendpoint=trunk-${id}\n`);
    });

    it("as mensagens de erro não revelam nada do outro tronco", () => {
      const { skipped } = renderTrunksConf([byIp, elsewhere({ ...byIp, host: "198.51.100.0/24" })]);
      expect(skipped.map((entry) => entry.id)).toEqual([B, C]);
      for (const { reason } of skipped) {
        // Nem id, nem endereço, nem nome, nem organização: o outro tronco é de outra empresa.
        expect(reason).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|198[.]51|[0-9]+[.][0-9]+[.][0-9]+|organi[sz]ation/i);
        expect(reason).toMatch(/another line of this installation.*registration/);
      }
    });

    it("tronco que não pode ser escrito não entra em grupo: não tira o identify de ninguém", () => {
      const broken = elsewhere({ ...byIp, username: "tem espaço" });
      const nameInIp = elsewhere({ ...byIp, host: "provedor.example" }, A);
      const { conf, skipped } = renderTrunksConf([byIp, broken, nameInIp]);
      expect(skipped.map((entry) => entry.id)).toEqual([A, C]);
      expect(conf).toBe(renderTrunksConf([byIp]).conf);
      expect(identifies(conf)).toEqual(["match=198.51.100.20"]);
    });
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
      { host: `198.51.100.9${evil}` },
      { host: "198.51.100.9/24\n[x]" },
      { host: "[2001:db8::1]\n[x]" },
      { host: "2001:db8::1%eth0\n[x]" },
      { host: "0x7f.0.0.1" },
      { host: "1.2.3" },
      { host: "999.1.1.1" },
      { host: "198.51.100.9/33" },
      { host: "sip.example:99999" },
      { username: `conta${evil}` },
      { username: "conta]\n[x" },
      { username: "conta;x" },
      { username: "conta 100" },
      { password: `senha${evil}` },
      { password: "senha\r[x]" },
      { password: `senha${String.fromCharCode(0x2028)}[x]` },
      { password: `senha${String.fromCharCode(0)}` },
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
    expect(sections(conf)).toHaveLength(4);
  });

  it("IP público malformado não entra no arquivo", () => {
    const { conf } = renderTrunksConf([{ ...register, publicIp: "203.0.113.10\n[x]" }]);
    expect(conf).not.toContain("from_domain");
    expect(sections(conf)).toHaveLength(4);
  });

  it("lê o host como nome, endereço ou bloco, e recusa o resto", () => {
    expect(parseTrunkHost(" SIP.Example.com. ")).toEqual({ kind: "name", uri: "sip.example.com" });
    expect(parseTrunkHost("sip.example.com:5061")).toEqual({ kind: "name", uri: "sip.example.com:5061" });
    expect(parseTrunkHost("010.001.002.003:05060")).toMatchObject({ kind: "address", uri: "10.1.2.3:5060", match: "10.1.2.3" });
    expect(parseTrunkHost("::1")).toMatchObject({ kind: "address", uri: "[::1]", match: "::1" });
    expect(parseTrunkHost("2001:db8:0:1:0:0:0:1")).toMatchObject({ match: "2001:db8:0:1::1" });
    expect(parseTrunkHost("10.0.0.0/8")).toMatchObject({ kind: "address", uri: null, match: "10.0.0.0/8" });
    expect(parseTrunkHost("10.1.2.3/32")).toMatchObject({ uri: "10.1.2.3", match: "10.1.2.3" });
    for (const bad of ["", "a b", "sip_example", "-a.example", "256.1.1.1", "1.2.3.4.5", "10.0.0.0/", "10.0.0.0/8/8", "[::1", "::1]:5060", "fe80::1%eth0", "sip.example:0", "sip.example:porta"]) {
      expect(parseTrunkHost(bad), bad).toBeNull();
    }
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

    it("com dono: entrega o arquivo ao usuário pedido e mantém 0640; sem poder trocar o dono, cai para 0644 em vez de deixar ilegível", async () => {
      const mode = async (file: string): Promise<string> => ((await stat(file)).mode & 0o777).toString(8);
      const mine = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
      const owned = path.join(dir, "dono", "pjsip_trunks.conf");
      expect(await writeFileAtomic(owned, "x")).toEqual({ mode: 0o640 });
      expect(await writeFileAtomic(owned, "x", mine)).toEqual({ mode: 0o640 });
      expect(await mode(owned)).toBe("640");
      expect((await stat(owned)).uid).toBe(mine.uid);
      // Quem não é root não consegue dar o arquivo a outro usuário (em CI que roda como root, consegue).
      if (mine.uid !== 0) {
        const fallback = path.join(dir, "dono", "sem-privilegio.conf");
        expect(await writeFileAtomic(fallback, "x", { uid: 0, gid: 0 })).toEqual({ mode: 0o644, chownError: expect.any(String) });
        expect(await mode(fallback)).toBe("644");
      }
      expect((await readdir(path.dirname(owned))).sort()).toEqual(["pjsip_trunks.conf", ...(mine.uid !== 0 ? ["sem-privilegio.conf"] : [])].sort());
    });

    it("se a troca falha, o arquivo anterior fica intacto e o temporário é removido", async () => {
      // O destino é uma pasta com conteúdo: o rename falha depois de o temporário já estar escrito.
      const target = path.join(dir, "ocupado");
      await writeFileAtomic(path.join(target, "dentro.conf"), "conteúdo\n");
      await writeFile(path.join(dir, "vizinho.conf"), "intacto\n");
      await expect(writeFileAtomic(target, "novo\n")).rejects.toThrow();
      expect((await readdir(dir)).sort()).toEqual(["dono", "generated", "ocupado", "vizinho.conf"]);
      expect(await readFile(path.join(target, "dentro.conf"), "utf8")).toBe("conteúdo\n");
    });
  });
});
