import { BlockList, isIP } from "node:net";

// Tudo o que não é internet pública: rede interna, a própria máquina, link-local (onde moram os
// metadados de nuvem, 169.254.169.254 e fd00:ec2::254), CGNAT, multicast e faixas reservadas.
// IPv6 que embute IPv4 (::ffff:a.b.c.d) é conferido pela `BlockList` contra as regras de IPv4.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  // A faixa de uso local do NAT64 (RFC 8215) embute IPv4 como a global acima: `64:ff9b:1::a00:1`
  // chega em `10.0.0.1` numa rede IPv6-only com NAT64.
  ["64:ff9b:1::", 48],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  // 6to4 (RFC 3056) e Teredo (RFC 4380) carregam o IPv4 de destino dentro do próprio endereço.
  ["2002::", 16],
  ["2001::", 32],
  // IPv4 traduzido (SIIT, RFC 7915): `::ffff:0:a.b.c.d` embute IPv4 como o mapeado, com um zero a
  // mais, e não cai na conferência de IPv4 que a `BlockList` faz para `::ffff:a.b.c.d`.
  ["::ffff:0:0:0", 96],
  // Site-local antigo (RFC 3879): fora de uso, mas ainda roteado dentro de redes que o mantêm, e
  // não está dentro de `fc00::/7`.
  ["fec0::", 10],
  // Prefixo de descarte (RFC 6666): nunca é um destino de verdade.
  ["100::", 64],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
