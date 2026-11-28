// A pasta de saída guarda a voz e a imagem de quem estava na reunião. Ela é só de quem roda a
// sonda: criada agora (nunca uma que já existia, que outra conta poderia ter preparado), com 0700,
// e cada arquivo com 0600, criado do zero. A máscara do processo não afrouxa nada disso, porque o
// modo é conferido e acertado depois de criar.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Cria a pasta da rodada. Sem caminho, uma pasta nova e de nome aleatório no TMPDIR. */
export function createOutDir(requested?: string): string {
  let dir: string;
  if (requested) {
    dir = path.resolve(requested);
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`--saida ${dir} já existe: a sonda só grava numa pasta nova, criada por ela`);
      throw error;
    }
  } else {
    dir = mkdtempSync(path.join(tmpdir(), "sonda-reuniao-"));
  }
  chmodSync(dir, 0o700);
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
    throw new Error(`a pasta ${dir} não ficou só de quem roda a sonda`);
  }
  return dir;
}

/** Grava um arquivo novo (falha se já existir), legível só por quem roda. */
export function writePrivate(file: string, data: string | Uint8Array): void {
  writeFileSync(file, data, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
}
