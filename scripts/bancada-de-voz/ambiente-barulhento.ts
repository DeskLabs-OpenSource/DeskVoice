/**
 * Ambiente barulhento contra o provedor (fatia 5 do desenho da DESA-24): o antes e depois em cada
 * motor de hoje, `normal` e `noisy`, com e sem a guarda contra o silêncio. Fora do CI e fora do
 * produto. Como rodar e o que não é medido: README.md desta pasta.
 *
 *   pnpm exec tsx scripts/bancada-de-voz/ambiente-barulhento.ts --teto-usd 0 \
 *     [--motores openai-hoje,gemini-hoje] [--frases 1] [--niveis 15,5,0] [--partes resposta,interrupcao,longa]
 *
 * A lógica (o teto, a guarda, as três medidas e a tabela) está em `barulho-no-provedor.ts` e tem
 * teste sem rede. Este arquivo só liga as peças de verdade: os motores de `servicos/`, o áudio de
 * `plano-do-barulho.ts` (Piper e ruído) e o relógio do sistema.
 *
 * Sem a chave do motor (`BANCADA_OPENAI_API_KEY`, `BANCADA_GEMINI_API_KEY`), ele sai como "chave
 * não entregue", e nem o Piper é chamado.
 */
import { realSchedule } from "../../apps/voice/src/transport";
import { bancadaContraOProvedor } from "./barulho-no-provedor";
import { montarPlano } from "./plano-do-barulho";
import { semAsChaves } from "./rodada";
import { GEMINI_DE_HOJE } from "./servicos/gemini-hoje";
import { OPENAI_DE_HOJE } from "./servicos/openai-hoje";
import { relogioDoSistema } from "./tempo-real";

bancadaContraOProvedor(process.argv.slice(2), {
  motores: [OPENAI_DE_HOJE, GEMINI_DE_HOJE],
  montarPlano,
  relogio: { ...relogioDoSistema, agendar: realSchedule },
  hoje: () => new Date().toISOString().slice(0, 10),
  saida: (linha) => void process.stdout.write(`${linha}\n`),
  progresso: (texto) => void process.stderr.write(`${texto}\n`),
}).catch((erro: unknown) => {
  process.stderr.write(`${semAsChaves(erro instanceof Error ? (erro.stack ?? erro.message) : String(erro))}\n`);
  process.exit(1);
});
