// A leitura do host de uma linha mora em `packages/core` (R8, fatia 10): o painel usa a mesma
// comparação para avisar, antes de salvar, que uma faixa cruza a de outra organização.
export { hostsOverlap, isBlockTooWide, parseTrunkHost, type TrunkHost } from "@deskvoice/core";
