import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseTrunkHost } from "./trunk-host";
import {
  allowedAddresses,
  BLOCK_TOO_WIDE_REASON,
  computeAllowed,
  EMPTY_ALLOWED,
  extraAddressReason,
  extraNameReason,
  extraTooWideReason,
  NAME_IN_IP_MODE_REASON,
  OUTBOUND_BLOCK_REASON,
  OUTBOUND_ONLY_IN_IP_MODE_REASON,
  plannedLinesChanged,
  MAX_FROM_NAME,
  RESOLVE_TIMEOUT_MS,
  renderTrunksConf,
  SHARED_HOST_REASON,
  TOO_MANY_FROM_NAME,
  trunkProblem,
  writeFileAtomic,
  type TrunkConfig,
} from "./trunks";

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
      expect(conf, host).not.toContain(B);
      expect(identifies(conf), host).toEqual([]);
    }
    expect(NAME_IN_IP_MODE_REASON).toMatch(/numeric address.*not a name.*registration/);
  });

  it("o reconhecimento por IP recusa bloco largo demais, no host e em cada item da lista", () => {
    for (const block of ["0.0.0.0/0", "::/0", "10.0.0.0/8", "198.51.0.0/15", "2001:db8::/16", "2001:db8::/31", "::ffff:0:0/96", "::ffff:10.0.0.0/104", "::/64"]) {
      const host = renderTrunksConf([{ ...byIp, host: block }, register]);
      expect(host.skipped, block).toEqual([{ id: B, reason: BLOCK_TOO_WIDE_REASON }]);
      expect(identifies(host.conf), block).toEqual([]);
      const extra = renderTrunksConf([{ ...byIp, matchExtra: ["203.0.113.0/24", block] }, register]);
      expect(extra.skipped, block).toEqual([{ id: B, reason: extraTooWideReason(2) }]);
      expect(identifies(extra.conf), block).toEqual([]);
    }
    for (const block of ["198.51.0.0/16", "2001:db8::/32", "::ffff:198.51.0.0/112"]) {
      expect(trunkProblem({ ...byIp, host: block }), block).toBeNull();
      expect(trunkProblem({ ...byIp, matchExtra: [block] }), block).toBeNull();
    }
    expect(BLOCK_TOO_WIDE_REASON).not.toMatch(/0[.]0[.]0[.]0|::\/0/);
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

  // Fonte: https://www.twilio.com/docs/sip-trunking/ip-addresses (medido em 14/11/2026). A Twilio
  // publica um bloco /30 por região de sinalização e manda liberar TODOS, porque a entrega muda de
  // região quando uma cai.
  const TWILIO_BLOCKS = ["54.172.60.0/30", "54.244.51.0/30", "54.171.127.192/30", "35.156.191.128/30", "54.65.63.192/30", "54.169.127.128/30", "54.252.254.64/30", "177.71.206.192/30"];

  describe("linha de operadora que entrega por vários blocos", () => {
    const canonical = (value: string): string => {
      const host = parseTrunkHost(value);
      if (host === null || host.kind !== "address") throw new Error(`not an address: ${value}`);
      return host.match;
    };
    /** O que o Asterisk faz com `match=`: a origem só entra se algum bloco do arquivo a contém. */
    const acceptedFrom = (conf: string, origin: string): boolean => {
      const source = parseTrunkHost(origin);
      if (source === null || source.kind !== "address") return false;
      return identifies(conf)
        .map((line) => parseTrunkHost(line.slice("match=".length)))
        .some((match) => match !== null && match.kind === "address" && match.start <= source.start && source.end <= match.end);
    };
    const network = (block: string): string => block.slice(0, block.indexOf("/"));
    const twilio: TrunkConfig = { ...byIp, host: TWILIO_BLOCKS[0] ?? "", matchExtra: TWILIO_BLOCKS.slice(1), outboundHost: "conta.pstn.twilio.com" };

    it("aceita a ligação de qualquer um dos blocos da operadora, e liga pelo nome da conta", () => {
      const { conf, skipped } = renderTrunksConf([twilio]);
      expect(skipped).toEqual([]);
      expect(identifies(conf)).toEqual(TWILIO_BLOCKS.map((block) => `match=${canonical(block)}`));
      for (const block of TWILIO_BLOCKS) expect([block, acceptedFrom(conf, network(block))]).toEqual([block, true]);
      expect(conf).toContain("contact=sip:conta.pstn.twilio.com");
    });

    it("origem fora de todos os blocos continua recusada: nenhum match a cobre", () => {
      const { conf } = renderTrunksConf([twilio]);
      for (const outside of ["203.0.113.7", "54.172.60.4", "8.8.8.8", "2001:db8::1"]) expect([outside, acceptedFrom(conf, outside)]).toEqual([outside, false]);
      // O `identify` só tem os blocos cadastrados; nenhum curinga entrou no lugar deles.
      expect(identifies(conf)).toHaveLength(TWILIO_BLOCKS.length);
      expect(conf).not.toMatch(/match=(?:0\.0\.0\.0\/0|::\/0)/);
    });

    it("a linha antiga, com um endereço só, continua igual: um match e o contato do host", () => {
      const before = renderTrunksConf([byIp]).conf;
      expect(renderTrunksConf([{ ...byIp, matchExtra: [] }]).conf).toBe(before);
      expect(identifies(before)).toEqual(["match=198.51.100.20"]);
      expect(before).toContain("contact=sip:198.51.100.20");
    });

    it("nome na lista de entrada é recusado: a lista só aceita IP ou bloco, e o nome do provedor vai na saída", () => {
      const { conf, skipped } = renderTrunksConf([{ ...twilio, matchExtra: [TWILIO_BLOCKS[1] ?? "", "blocos.operadora.example"] }]);
      expect(skipped).toEqual([{ id: B, reason: extraNameReason(2) }]);
      expect(skipped[0]?.reason).not.toMatch(/54[.]|blocos/);
      expect(conf).not.toContain(B);
    });

    it("todos os blocos publicados da Twilio passam pelo piso de prefixo", () => {
      for (const block of TWILIO_BLOCKS) expect([block, trunkProblem({ ...byIp, host: block })]).toEqual([block, null]);
    });

    it("endereço extra repetido não vira match repetido", () => {
      const { conf } = renderTrunksConf([{ ...byIp, host: "198.51.100.20/30", matchExtra: ["198.51.100.20/30"] }]);
      expect(identifies(conf)).toEqual(["match=198.51.100.20/30"]);
    });

    it("a recusa diz qual item não casou, sem repetir a lista inteira", () => {
      const { conf, skipped } = renderTrunksConf([{ ...twilio, matchExtra: [TWILIO_BLOCKS[1] ?? "", "[evil]"] }]);
      expect(skipped).toEqual([{ id: B, reason: extraAddressReason(2) }]);
      expect(skipped[0]?.reason).not.toMatch(/54[.]|177[.]|198[.]|\[evil\]/);
      expect(conf).not.toContain(B);
    });

    it("destino de saída só existe no modo por IP; o endereço extra vale nos dois modos; bloco não é destino", () => {
      expect(trunkProblem({ ...register, matchExtra: [TWILIO_BLOCKS[1] ?? ""] })).toBeNull();
      expect(trunkProblem({ ...register, matchExtra: ["outro.operadora.example"] })).toBe(extraNameReason(1));
      expect(trunkProblem({ ...register, matchExtra: ["10.0.0.0/8"] })).toBe(extraTooWideReason(1));
      expect(trunkProblem({ ...register, outboundHost: "conta.pstn.twilio.com" })).toBe(OUTBOUND_ONLY_IN_IP_MODE_REASON);
      expect(trunkProblem({ ...byIp, outboundHost: "54.172.60.0/30" })).toBe(OUTBOUND_BLOCK_REASON);
      expect(trunkProblem(twilio)).toBeNull();
    });

    it("cada bloco entra na regra de endereço compartilhado, não só o host", () => {
      const mine: TrunkConfig = { ...byIp, host: "203.0.113.0/24", matchExtra: ["198.51.100.0/24"] };
      const theirs: TrunkConfig = { ...byIp, id: C, organizationId: ORG2, host: "198.51.100.64/26" };
      const { conf, skipped } = renderTrunksConf([mine, theirs]);
      expect(skipped.map((entry) => entry.id)).toEqual([B, C]);
      expect(identifies(conf)).toEqual([]);
    });
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
    // O NTFS não guarda modo POSIX: `stat().mode` devolve 0o666 e `chmod` só alterna o atributo
    // somente-leitura. Onde o modo existe — o Linux, que é onde a instalação roda — 0640 é o que
    // impede outro usuário do servidor de ler a senha da linha, então a afirmação não pode ser
    // afrouxada para todo mundo: ela é pulada no Windows, com o motivo no nome do caso (#48).
    const hasPosixMode = process.platform !== "win32";
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

    it("com dono: aceita o dono pedido; sem poder trocar o dono, cai para 0644 em vez de deixar ilegível", async () => {
      const mine = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
      const owned = path.join(dir, "dono", "pjsip_trunks.conf");
      expect(await writeFileAtomic(owned, "x")).toEqual({ mode: 0o640 });
      expect(await writeFileAtomic(owned, "x", mine)).toEqual({ mode: 0o640 });
      // Quem não é root não consegue dar o arquivo a outro usuário (em CI que roda como root, consegue).
      if (mine.uid !== 0) {
        const fallback = path.join(dir, "dono", "sem-privilegio.conf");
        expect(await writeFileAtomic(fallback, "x", { uid: 0, gid: 0 })).toEqual({ mode: 0o644, chownError: expect.any(String) });
        if (hasPosixMode) expect((await stat(fallback)).mode & 0o777).toBe(0o644);
      }
      expect((await readdir(path.dirname(owned))).sort()).toEqual(["pjsip_trunks.conf", ...(mine.uid !== 0 ? ["sem-privilegio.conf"] : [])].sort());
    });

    it.skipIf(!hasPosixMode)("no disco, o arquivo fica 0640 e com o dono pedido (pulado no Windows, onde o NTFS devolve 0666)", async () => {
      const own = await mkdtemp(path.join(tmpdir(), "deskvoice-trunks-modo-"));
      try {
        const mine = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
        const file = path.join(own, "pjsip_trunks.conf");
        expect(await writeFileAtomic(file, "x", mine)).toEqual({ mode: 0o640 });
        expect((await stat(file)).mode & 0o777).toBe(0o640);
        expect((await stat(file)).uid).toBe(mine.uid);
      } finally {
        await rm(own, { recursive: true, force: true });
      }
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

// R14, fatia 1: de onde a central aceita a ligação de cada linha. Os formatos são os que a 0.19.0
// (a última publicada) aceita na tela: por IP com e sem extras, registro com IP, registro com nome.
describe("conjunto de endereços liberados por linha", () => {
  const SIP = "sip.operadora.example";
  const resolver = (answers: Record<string, string[] | Error>) => {
    const asked: string[] = [];
    const resolve = async (name: string): Promise<string[]> => {
      asked.push(name);
      const answer = answers[name];
      if (answer === undefined) throw Object.assign(new Error(`queryA ENOTFOUND ${name}`), { code: "ENOTFOUND" });
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { resolve, asked };
  };
  afterEach(() => vi.useRealTimers());

  it("linha por IP: o host e os extras, canônicos e sem repetição", async () => {
    expect(allowedAddresses(byIp)).toEqual(["198.51.100.20"]);
    expect(allowedAddresses({ ...byIp, host: "198.051.100.020:5080" })).toEqual(["198.51.100.20"]);
    expect(allowedAddresses({ ...byIp, host: "54.172.60.1/30", matchExtra: ["54.244.51.0/30", "54.172.60.0/30", "2001:DB8::1"] })).toEqual(["54.172.60.0/30", "54.244.51.0/30", "2001:db8::1"]);
    const { resolve, asked } = resolver({});
    expect(await computeAllowed({ resolve }, [byIp], new Map())).toEqual(new Map([[B, { addresses: ["198.51.100.20"], fromName: [], seen: {} }]]));
    // Linha por IP nunca pergunta ao DNS.
    expect(asked).toEqual([]);
  });

  it("registro com IP no host: esse IP, com a porta fora", async () => {
    const withIp: TrunkConfig = { ...register, host: "203.0.113.5:5080" };
    const { resolve, asked } = resolver({});
    expect((await computeAllowed({ resolve }, [withIp], new Map())).get(A)).toEqual({ addresses: ["203.0.113.5"], fromName: [], seen: {} });
    expect(asked).toEqual([]);
  });

  it("registro com nome: A, AAAA e alvos do SRV que o resolvedor devolve, em ordem fixa e canônica, mais os extras", async () => {
    const { resolve, asked } = resolver({ [SIP]: ["203.0.113.9", "2001:DB8:0:0::5", "203.0.113.7", "203.0.113.9", "lixo"] });
    const withExtra: TrunkConfig = { ...register, matchExtra: ["198.51.100.0/24"] };
    const now = new Date("2026-11-16T12:00:00.000Z");
    expect((await computeAllowed({ resolve }, [withExtra], new Map(), { now })).get(A)).toEqual({
      addresses: ["2001:db8::5", "203.0.113.7", "203.0.113.9", "198.51.100.0/24"],
      fromName: ["2001:db8::5", "203.0.113.7", "203.0.113.9"],
      seen: { "2001:db8::5": now.toISOString(), "203.0.113.7": now.toISOString(), "203.0.113.9": now.toISOString() },
    });
    // A porta não vai na pergunta.
    expect(asked).toEqual([SIP]);
  });

  it("um pedido por nome, mesmo com várias linhas no mesmo servidor", async () => {
    const { resolve, asked } = resolver({ [SIP]: ["203.0.113.7"] });
    const other: TrunkConfig = { ...register, id: C, host: SIP };
    const allowed = await computeAllowed({ resolve }, [register, other], new Map());
    expect([allowed.get(A)?.addresses, allowed.get(C)?.addresses]).toEqual([["203.0.113.7"], ["203.0.113.7"]]);
    expect(asked).toEqual([SIP]);
  });

  it("nome que não resolve MANTÉM o último conjunto (somado aos extras de agora) e diz o motivo; nunca encolhe para vazio", async () => {
    const before = new Map([[A, ["203.0.113.7", "203.0.113.9"]]]);
    for (const failure of [new Error("queryA ESERVFAIL sip.operadora.example"), undefined]) {
      const { resolve } = resolver(failure === undefined ? {} : { [SIP]: failure });
      const allowed = (await computeAllowed({ resolve }, [{ ...register, matchExtra: ["198.51.100.1"] }], before)).get(A);
      expect(allowed?.addresses).toEqual(["203.0.113.7", "203.0.113.9", "198.51.100.1"]);
      expect(allowed?.problem).toMatch(/^The provider name could not be resolved \(sip\.operadora\.example: .*\)\. The line keeps the addresses it had/);
    }
    // Sem conjunto anterior (linha nova, DNS fora), fica o que dá para saber sem DNS: os extras.
    const { resolve } = resolver({});
    expect((await computeAllowed({ resolve }, [register], new Map())).get(A)).toMatchObject({ addresses: [] , problem: expect.any(String) });
  });

  it("resposta sem nenhum endereço utilizável conta como falha (mantém), e não como conjunto vazio", async () => {
    const { resolve } = resolver({ [SIP]: [] });
    const allowed = (await computeAllowed({ resolve }, [register], new Map([[A, ["203.0.113.7"]]]))).get(A);
    expect(allowed).toMatchObject({ addresses: ["203.0.113.7"], problem: expect.stringContaining("resolves to no address") });
  });

  it(`o nome que não responde em ${RESOLVE_TIMEOUT_MS / 1000} s conta como falha`, async () => {
    vi.useFakeTimers();
    const resolve = (): Promise<string[]> => new Promise(() => undefined);
    const pending = computeAllowed({ resolve }, [register], new Map([[A, ["203.0.113.7"]]]));
    await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS - 1);
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).get(A)).toMatchObject({ addresses: ["203.0.113.7"], problem: expect.stringContaining("no answer in 3 s") });
  });

  it("bloco largo demais e nome nunca entram no conjunto", () => {
    expect(allowedAddresses({ host: "198.51.100.20", matchExtra: ["10.0.0.0/8", "nome.example", "::/0", "54.172.60.0/30"] })).toEqual(["198.51.100.20", "54.172.60.0/30"]);
    expect(allowedAddresses({ host: SIP }, ["0.0.0.0/0", "203.0.113.7"])).toEqual(["203.0.113.7"]);
  });

  it("linha por registro com extra: o arquivo gerado sai igual ao de hoje (nenhum match= novo), e o extra não entra na regra de endereço compartilhado", () => {
    const extra = ["198.51.100.20", "54.172.60.0/30"];
    for (const host of [register.host, "203.0.113.5"]) {
      const today = renderTrunksConf([{ ...register, host }]);
      expect(renderTrunksConf([{ ...register, host, matchExtra: extra }])).toEqual(today);
    }
    // O extra da linha por registro bate no host da linha por IP de outra organização: ela segue emitida.
    const theirs: TrunkConfig = { ...byIp, organizationId: ORG2 };
    const { skipped, conf } = renderTrunksConf([{ ...register, matchExtra: extra }, theirs]);
    expect(skipped).toEqual([]);
    expect(identifies(conf)).toEqual(["match=198.51.100.20"]);
    expect(blocksOf(conf, B)).toContain(`[trunk-${B}-identify]`);
  });
});

describe("o filtro de entrada por linha (R14, fatia 2)", () => {
  const SIP = "sip.operadora.example";
  /** As linhas da seção `type=endpoint` de um tronco. */
  const endpointOf = (conf: string, id: string): string[] => (conf.split("\n\n").find((block) => block.startsWith(`[trunk-${id}]\ntype=endpoint`)) ?? "").split("\n");
  const acl = (conf: string, id: string): string[] => endpointOf(conf, id).filter((line) => /^(deny|permit)=/.test(line));
  const failing = async (): Promise<string[]> => {
    throw Object.assign(new Error(`queryA ESERVFAIL ${SIP}`), { code: "ESERVFAIL" });
  };
  const addressesOf = (allowed: Map<string, { addresses: string[] }>) => new Map([...allowed].map(([id, entry]) => [id, entry.addresses]));

  it("cada endpoint recusa tudo e libera só os endereços DELE; nenhuma lista global (type=acl)", () => {
    const allowed = new Map([
      [A, ["203.0.113.7", "2001:db8::5", "198.51.100.0/24"]],
      [B, ["198.51.100.20"]],
    ]);
    const { conf } = renderTrunksConf([register, byIp], allowed);
    expect(acl(conf, A)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.7", "permit=2001:db8::5", "permit=198.51.100.0/24"]);
    expect(acl(conf, B)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=198.51.100.20"]);
    expect(conf).not.toMatch(/type=acl/);
    // O filtro fica só na seção do endpoint: nem no aor, nem no identify, nem no registro.
    expect(conf.split("\n").filter((line) => /^(deny|permit)=/.test(line))).toHaveLength(8);
  });

  it("com o filtro desligado na linha (contrato 11), o conjunto cheio sai sem deny e sem permit; ausente vale ligado", () => {
    const allowed = new Map([
      [A, ["203.0.113.7", "198.51.100.1"]],
      [B, ["198.51.100.20"]],
    ]);
    const off = renderTrunksConf([{ ...register, inboundFilter: false }, byIp], allowed).conf;
    expect(acl(off, A)).toEqual([]);
    expect(acl(off, B)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=198.51.100.20"]);
    // O resto do endpoint é o mesmo da linha sem conjunto: o filtro desligado só tira o deny e o permit.
    expect(endpointOf(off, A)).toEqual(endpointOf(renderTrunksConf([register, byIp]).conf, A));
    const on = renderTrunksConf([{ ...register, inboundFilter: true }, byIp], allowed).conf;
    expect(acl(on, A)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.7", "permit=198.51.100.1"]);
    expect(acl(renderTrunksConf([register, byIp], allowed).conf, A)).toEqual(acl(on, A));
  });

  it("a linha por IP filtra sempre, mesmo com a coluna desligada (filtro efetivo, contrato 11)", () => {
    // A linha por registro com o filtro desligado que passa a IP leva a coluna `false` junto.
    const allowed = new Map([[B, ["198.51.100.20"]]]);
    const { conf } = renderTrunksConf([{ ...byIp, inboundFilter: false }], allowed);
    expect(acl(conf, B)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=198.51.100.20"]);
  });

  it("nome, bloco largo demais e repetição nunca viram permit; o que sobra é canônico", () => {
    const { conf } = renderTrunksConf([byIp], new Map([[B, ["198.051.100.020", "nome.example", "10.0.0.0/8", "::/0", "198.51.100.20", "2001:DB8::1"]]]));
    expect(acl(conf, B)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=198.51.100.20", "permit=2001:db8::1"]);
    // Nada que sirva: sem filtro, nunca um deny sozinho.
    expect(acl(renderTrunksConf([byIp], new Map([[B, ["nome.example", "0.0.0.0/0"]]])).conf, B)).toEqual([]);
  });

  it("isolamento: duas organizações com o mesmo nome de operadora e resoluções diferentes no tempo; nenhum endereço de uma no endpoint da outra", async () => {
    const theirs: TrunkConfig = { ...register, id: C, organizationId: ORG2, username: "conta200" };
    // A resolução falha agora: cada linha fica com o que o nome dela resolveu da última vez.
    const previous = new Map([
      [A, ["203.0.113.7"]],
      [C, ["198.51.100.99"]],
    ]);
    const allowed = await computeAllowed({ resolve: failing }, [register, theirs], previous);
    const { conf } = renderTrunksConf([register, theirs], addressesOf(allowed));
    expect(acl(conf, A)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.7"]);
    expect(acl(conf, C)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=198.51.100.99"]);
    // E com uma linha por IP da outra organização ao lado: o endereço dela só no endpoint dela.
    const ipTheirs: TrunkConfig = { ...byIp, organizationId: ORG2 };
    const both = renderTrunksConf([register, ipTheirs], new Map([[A, ["203.0.113.7"]], [B, ["198.51.100.20"]]])).conf;
    expect(endpointOf(both, A).join("\n")).not.toContain("198.51.100.20");
    expect(endpointOf(both, B).join("\n")).not.toContain("203.0.113.7");
  });

  it("DNS falhando: o permit é o mesmo conjunto que vai para a tela (inbound_allowed)", async () => {
    const line: TrunkConfig = { ...register, matchExtra: ["198.51.100.1"] };
    const allowed = await computeAllowed({ resolve: failing }, [line], new Map([[A, ["203.0.113.7", "203.0.113.9"]]]));
    const shown = allowed.get(A)?.addresses ?? [];
    expect(shown).toEqual(["203.0.113.7", "203.0.113.9", "198.51.100.1"]);
    expect(acl(renderTrunksConf([line], addressesOf(allowed)).conf, A).filter((rule) => rule.startsWith("permit="))).toEqual(shown.map((address) => `permit=${address}`));
  });

  it("extra removido com o DNS falhando sai do permit; extra mudado mantém a parte do nome", async () => {
    const fromName = new Map([[A, ["203.0.113.7"]]]);
    const removed = await computeAllowed({ resolve: failing }, [{ ...register, matchExtra: [] }], fromName);
    expect(removed.get(A)).toMatchObject({ addresses: ["203.0.113.7"], fromName: ["203.0.113.7"] });
    expect(acl(renderTrunksConf([register], addressesOf(removed)).conf, A)).not.toContain("permit=198.51.100.1");
    const changed = await computeAllowed({ resolve: failing }, [{ ...register, matchExtra: ["198.51.100.2"] }], fromName);
    expect(changed.get(A)).toMatchObject({ addresses: ["203.0.113.7", "198.51.100.2"], fromName: ["203.0.113.7"] });
  });

  it("conjunto vazio de linha ativa: endpoint sem deny e sem permit, e a linha fica 'warn' com o motivo", async () => {
    const allowed = await computeAllowed({ resolve: failing }, [register], new Map());
    expect(allowed.get(A)).toMatchObject({ addresses: [], fromName: [], problem: expect.stringMatching(new RegExp(`^${EMPTY_ALLOWED}; its filter stays off until the name ${SIP} resolves\\.`)) });
    const { conf, emitted } = renderTrunksConf([register], addressesOf(allowed));
    expect(emitted).toEqual([A]);
    expect(acl(conf, A)).toEqual([]);
    // Sem conjunto calculado, também sem filtro (o arquivo gerado antigo, antes da primeira aplicação).
    expect(acl(renderTrunksConf([register]).conf, A)).toEqual([]);
  });

  it("o nome resolve: o deny e o permit entram, e a linha não fica 'warn'", async () => {
    const allowed = await computeAllowed({ resolve: async () => ["203.0.113.9", "203.0.113.7"] }, [register], new Map());
    expect(allowed.get(A)).toMatchObject({ addresses: ["203.0.113.7", "203.0.113.9"], fromName: ["203.0.113.7", "203.0.113.9"] });
    expect(allowed.get(A)?.problem).toBeUndefined();
    expect(acl(renderTrunksConf([register], addressesOf(allowed)).conf, A)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.7", "permit=203.0.113.9"]);
  });

  it("linha por IP nunca tem conjunto vazio, nem com o DNS fora", async () => {
    const lines: TrunkConfig[] = [byIp, { ...byIp, id: C, host: "54.172.60.0/30" }, { ...register, host: "203.0.113.5:5080" }];
    const allowed = await computeAllowed({ resolve: failing }, lines, new Map());
    for (const line of lines) expect(allowed.get(line.id)?.addresses.length, line.host).toBeGreaterThan(0);
    for (const line of lines) expect(allowed.get(line.id)?.problem).toBeUndefined();
  });

  it(`um nome que resolve 20 endereços: ficam os ${MAX_FROM_NAME} primeiros em ordem canônica, e a linha fica 'warn'`, async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `203.0.113.${100 + index}`);
    const extras = Array.from({ length: 16 }, (_, index) => `198.51.100.${index + 1}`);
    for (const order of [twenty, [...twenty].reverse()]) {
      const allowed = (await computeAllowed({ resolve: async () => order }, [{ ...register, matchExtra: extras }], new Map())).get(A);
      expect(allowed?.fromName).toEqual(twenty.slice(0, MAX_FROM_NAME));
      expect(allowed?.problem).toMatch(new RegExp(`^${TOO_MANY_FROM_NAME} \\(${SIP.replaceAll(".", "\\.")}\\)`));
      // O teto da linha: 16 do nome e 16 extras (o host é nome).
      expect(allowed?.addresses).toHaveLength(32);
    }
    // Com o DNS fora, o que veio guardado também respeita o teto.
    const kept = (await computeAllowed({ resolve: failing }, [register], new Map([[A, twenty]]))).get(A);
    expect(kept?.fromName).toHaveLength(MAX_FROM_NAME);
  });
  it("nome que nunca resolveu, com extras: sem filtro (os extras sozinhos não ligam o filtro), e a linha fica 'warn'", async () => {
    const line: TrunkConfig = { ...register, matchExtra: ["198.51.100.1", "54.172.60.0/30"] };
    const allowed = (await computeAllowed({ resolve: failing }, [line], new Map())).get(A);
    expect(allowed).toMatchObject({ addresses: [], fromName: [], problem: expect.stringMatching(new RegExp(`^${EMPTY_ALLOWED}`)) });
    expect(acl(renderTrunksConf([line], new Map([[A, allowed?.addresses ?? []]])).conf, A)).toEqual([]);
    // O mesmo com a resposta sem endereço que sirva.
    const useless = (await computeAllowed({ resolve: async () => ["lixo"] }, [line], new Map())).get(A);
    expect(useless).toMatchObject({ addresses: [], fromName: [] });
    // Quando o nome resolve, os extras entram junto.
    const resolved = (await computeAllowed({ resolve: async () => ["203.0.113.7"] }, [line], new Map())).get(A);
    expect(resolved?.addresses).toEqual(["203.0.113.7", "198.51.100.1", "54.172.60.0/30"]);
  });

  describe("a parte do nome é a união das respostas das últimas 24 horas", () => {
    const t0 = new Date("2026-11-16T00:00:00.000Z");
    const at = (hours: number): Date => new Date(t0.getTime() + hours * 3_600_000);
    /** Aplica a linha várias vezes, cada uma com a resposta do DNS daquela hora, guardando como o processo de voz guarda. */
    async function rounds(answers: Array<[number, string[] | Error]>): Promise<Array<{ addresses: string[]; problem?: string }>> {
      let fromName = new Map<string, string[]>();
      let seen = new Map<string, Record<string, string>>();
      const out: Array<{ addresses: string[]; problem?: string }> = [];
      for (const [hours, answer] of answers) {
        const resolve = async (): Promise<string[]> => {
          if (answer instanceof Error) throw answer;
          return answer;
        };
        const allowed = (await computeAllowed({ resolve }, [register], fromName, { previousSeen: seen, now: at(hours) })).get(A);
        if (!allowed) throw new Error("no line");
        fromName = new Map([[A, allowed.fromName]]);
        seen = new Map([[A, allowed.seen]]);
        out.push({ addresses: allowed.addresses, ...(allowed.problem === undefined ? {} : { problem: allowed.problem }) });
      }
      return out;
    }

    it("DNS em rodízio (uma parte a cada consulta): o permit não oscila, junta as respostas da janela", async () => {
      const [first, second, third] = await rounds([
        [0, ["203.0.113.1", "203.0.113.2"]],
        [1, ["203.0.113.3", "203.0.113.4"]],
        [2, ["203.0.113.1", "203.0.113.2"]],
      ]);
      expect(first?.addresses).toEqual(["203.0.113.1", "203.0.113.2"]);
      expect(second?.addresses).toEqual(["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"]);
      expect(third?.addresses).toEqual(["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"]);
      expect(acl(renderTrunksConf([register], new Map([[A, third?.addresses ?? []]])).conf, A).filter((rule) => rule.startsWith("permit="))).toHaveLength(4);
      for (const round of [first, second, third]) expect(round?.problem).toBeUndefined();
    });

    it("o endereço que nenhuma resposta trouxe em 24 horas sai; o que voltou na janela fica", async () => {
      const out = await rounds([
        [0, ["203.0.113.1", "203.0.113.2"]],
        [20, ["203.0.113.2"]],
        [24, ["203.0.113.3"]],
        [24.5, ["203.0.113.3"]],
      ]);
      // Às 24 h o .1 (visto às 0 h) ainda está na janela, no limite; meia hora depois, não.
      expect(out[2]?.addresses).toEqual(["203.0.113.1", "203.0.113.2", "203.0.113.3"]);
      expect(out[3]?.addresses).toEqual(["203.0.113.2", "203.0.113.3"]);
    });

    it("com o DNS fora, nada vence: a parte do nome fica como estava, mesmo depois de 24 horas", async () => {
      const out = await rounds([
        [0, ["203.0.113.1"]],
        [1, ["203.0.113.2"]],
        [48, new Error("SERVFAIL")],
      ]);
      expect(out[2]?.addresses).toEqual(["203.0.113.1", "203.0.113.2"]);
      expect(out[2]?.problem).toMatch(/^The provider name could not be resolved/);
      // E quando volta, só a janela conta: o que não volta em 24 horas sai.
      const back = await rounds([
        [0, ["203.0.113.1"]],
        [1, ["203.0.113.2"]],
        [48, new Error("SERVFAIL")],
        [49, ["203.0.113.2"]],
      ]);
      expect(back[3]?.addresses).toEqual(["203.0.113.2"]);
    });

    it(`o teto vale para a união: no máximo ${MAX_FROM_NAME}, primeiro a resposta de agora, depois os vistos mais recentemente, e 'warn'`, async () => {
      const block = (from: number): string[] => Array.from({ length: 8 }, (_, index) => `203.0.113.${from + index}`);
      const out = await rounds([
        [0, block(10)],
        [1, block(20)],
        [2, block(30)],
      ]);
      expect(out[1]?.addresses).toHaveLength(16);
      expect(out[1]?.problem).toBeUndefined();
      // Às 2 h há 24 na janela: ficam os 8 de agora e os 8 de 1 h; os de 0 h saem.
      expect(out[2]?.addresses).toEqual([...block(20), ...block(30)].sort());
      expect(out[2]?.problem).toMatch(new RegExp(`^${TOO_MANY_FROM_NAME}`));
    });

    it("endereço guardado sem hora conhecida não conta como visto na janela; hora no futuro conta", async () => {
      const allowed = (
        await computeAllowed({ resolve: async () => ["203.0.113.2"] }, [register], new Map([[A, ["203.0.113.1"]]]), { previousSeen: new Map([[A, {}]]), now: t0 })
      ).get(A);
      expect(allowed?.fromName).toEqual(["203.0.113.2"]);
      // Já uma hora no futuro (o relógio voltou) conta: o filtro não encolhe por isso.
      const future = (
        await computeAllowed({ resolve: async () => ["203.0.113.2"] }, [register], new Map([[A, ["203.0.113.1"]]]), {
          previousSeen: new Map([[A, { "203.0.113.1": at(5).toISOString() }]]),
          now: t0,
        })
      ).get(A);
      expect(future?.fromName).toEqual(["203.0.113.1", "203.0.113.2"]);
    });
  });
});

describe("plannedLinesChanged (R8, fatia 9b)", () => {
  const plan = (...ids: string[]) => ({ stored: new Map(ids.map((id) => [id, { allowed: [], fromName: [], seen: {}, lastError: null, host: "h", authMode: "register" }])) });

  it("a line that leaves the plan, or comes in, changes the set; the same lines in another order do not", () => {
    const applied = "a,b,c";
    expect(plannedLinesChanged(applied, plan("c", "a", "b"))).toBe(false);
    expect(plannedLinesChanged(applied, plan("a", "c"))).toBe(true);
    expect(plannedLinesChanged(applied, plan("a", "b", "c", "d"))).toBe(true);
  });

  it("with nothing applied yet by this process, the clock applies", () => {
    expect(plannedLinesChanged(undefined, plan())).toBe(true);
    expect(plannedLinesChanged(undefined, plan("a"))).toBe(true);
  });
});
