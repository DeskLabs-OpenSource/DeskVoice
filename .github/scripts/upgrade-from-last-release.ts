/**
 * Teste de atualização do CI: prova que quem está na última versão publicada chega ao schema deste
 * commit sem perder dado. Aplica as migrations da última tag num banco vazio, grava dados de
 * exemplo e aplica as migrations do commit por cima, com o executor de verdade (o mesmo que o
 * `update.sh` usa, inclusive a recusa de migration editada depois de publicada).
 *
 *   tsx .github/scripts/upgrade-from-last-release.ts <url-do-banco> <migrations-da-tag> <migrations-atuais>
 *
 * Origem: no Deskcomm o schema de instalação nova e o de quem atualizava divergiram, e o
 * atualizador nunca era testado.
 */
import { createDb, runMigrations } from "../../packages/core/src/index";

const [url, previousDir, currentDir] = process.argv.slice(2);
if (!url || !previousDir || !currentDir) {
  process.stderr.write("uso: upgrade-from-last-release.ts <url> <migrations-da-tag> <migrations-atuais>\n");
  process.exit(2);
}

const SAMPLE_ORG = "Upgrade Test Org";
const db = createDb(url);
try {
  const fromRelease = await runMigrations(db, previousDir);
  // Dado mínimo que existe desde a primeira migration. Quando uma versão publicada tiver mais
  // tabelas com dado que importa preservar, o exemplo cresce aqui.
  await db.pool.query("insert into organizations (name) values ($1)", [SAMPLE_ORG]);
  const fromThisCommit = await runMigrations(db, currentDir);
  const { rows } = await db.pool.query("select count(*)::int as total from organizations where name = $1", [SAMPLE_ORG]);
  if (rows[0]?.total !== 1) throw new Error(`o dado de exemplo não sobreviveu à atualização (achei ${String(rows[0]?.total)})`);
  process.stdout.write(`última versão: ${fromRelease.length} migration(s); este commit aplicou mais ${fromThisCommit.length}; o dado de exemplo sobreviveu\n`);
} finally {
  await db.close();
}
