// CPU e memória do Chromium da sonda, lidos do /proc (Linux). É a medida que decide o limite de
// reuniões por instalação (seção 4 do desenho). Fora do Linux, a sonda diz "não medido".
import { existsSync, readdirSync, readFileSync } from "node:fs";

/** Os campos que a sonda usa de /proc/<pid>/stat. O nome do processo vem entre parênteses e pode ter espaço. */
export function parseStat(text: string): { ppid: number; ticks: number; rssPages: number } | null {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  // Depois do ")": estado(3) ppid(4) ... utime(14) stime(15) ... rss(24), contando a partir de 1.
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const at = (n: number): number => Number(fields[n - 3]);
  const ppid = at(4);
  const ticks = at(14) + at(15);
  const rssPages = at(24);
  return [ppid, ticks, rssPages].every(Number.isFinite) ? { ppid, ticks, rssPages } : null;
}

/** Todos os descendentes de `root` (sem ele), a partir do mapa pid → stat. */
export function descendants(root: number, stats: Map<number, { ppid: number }>): number[] {
  const out: number[] = [];
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const [pid, stat] of stats) {
      if (stat.ppid === parent && !out.includes(pid)) {
        out.push(pid);
        queue.push(pid);
      }
    }
  }
  return out;
}

export interface Sample {
  /** Milissegundos desde o início da medida. */
  atMs: number;
  ticks: number;
  rssBytes: number;
}

// Linux x86-64 e arm64: 100 tiques por segundo e página de 4 KiB. Escrito aqui porque o Node não
// os expõe; o relatório os repete para quem rodar numa máquina diferente.
export const CLOCK_TICKS = 100;
export const PAGE_BYTES = 4096;

export const canMeasure = (): boolean => existsSync("/proc/self/stat");

/** Uma leitura da soma dos processos filhos da sonda (o Chromium e os ajudantes dele). */
export function sampleChildren(atMs: number, root = process.pid): Sample {
  const stats = new Map<number, { ppid: number; ticks: number; rssPages: number }>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = parseStat(readFileSync(`/proc/${name}/stat`, "utf8"));
      if (stat) stats.set(Number(name), stat);
    } catch {
      // O processo saiu entre a lista e a leitura.
    }
  }
  let ticks = 0;
  let rssPages = 0;
  for (const pid of descendants(root, stats)) {
    ticks += stats.get(pid)!.ticks;
    rssPages += stats.get(pid)!.rssPages;
  }
  return { atMs, ticks, rssBytes: rssPages * PAGE_BYTES };
}

export interface Usage {
  samples: number;
  /** Em % de um núcleo: 100 = um núcleo inteiro ocupado. */
  cpuMeanPercent: number;
  cpuMaxPercent: number;
  rssMaxMb: number;
  rssMeanMb: number;
}

/** CPU entre leituras seguidas e memória de cada leitura. Precisa de duas leituras ou mais. */
export function summarize(samples: Sample[]): Usage | null {
  if (samples.length < 2) return null;
  const cpu: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const seconds = (samples[i]!.atMs - samples[i - 1]!.atMs) / 1000;
    if (seconds > 0) cpu.push(((samples[i]!.ticks - samples[i - 1]!.ticks) / CLOCK_TICKS / seconds) * 100);
  }
  const mb = samples.map((s) => s.rssBytes / 1024 / 1024);
  const round = (n: number): number => Math.round(n * 10) / 10;
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    samples: samples.length,
    cpuMeanPercent: round(mean(cpu)),
    cpuMaxPercent: round(Math.max(0, ...cpu)),
    rssMaxMb: round(Math.max(...mb)),
    rssMeanMb: round(mean(mb)),
  };
}
