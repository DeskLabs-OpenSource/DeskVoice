// Sonda do Meet (R15, fatia 1 do desenho docs/specs/2026-11-23-canal-de-reunioes.md).
//
// Um Chromium sem tela entra numa reunião do Google Meet pelo link, como convidado "Nome (IA)",
// espera o anfitrião admitir, toca 10 s de fala gravada, grava 30 s do que ouve e sai. Mede a
// admissão, a CPU e a memória do Chromium e o nível do áudio nos dois sentidos.
//
// Decisão do dono (pedido 3, 26/11/2026): roda UMA vez, numa reunião nossa, com o dono como
// anfitrião. Não é para rodar em reunião de outra pessoa: o robots.txt do Meet bloqueia o endereço
// da reunião (seção 2.4 do desenho). Por isso a sonda só anda com `--anfitriao-presente`.
//
// Uso (Linux, para medir CPU e memória; no macOS mede o resto):
//   pnpm --filter ./apps/panel exec playwright install chromium   # uma vez
//   pnpm exec tsx scripts/sonda-reuniao/sonda.ts https://meet.google.com/abc-defg-hij --anfitriao-presente \
//     [--nome Sonda] [--fala a.wav --fala b.wav] [--espera-lobby 300] [--saida /tmp/x] [--com-tela]
//
// A sonda não diz "passou". Ela diz o que mediu, e o resultado só vale com o ouvido humano dos
// dois lados (o fracasso nomeado no desenho é a sonda "passar" sem ninguém ter ouvido).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { audioStats, concat, downsample, fitTo, readWav, writeWav, type AudioStats, type Pcm } from "./audio";
import { loadPlaywright } from "./dependencias";
import { displayName, join, leave, maskCode, meetingCode, type Admission, type Step } from "./meet";
import { pageScript, type RtcNumbers } from "./pagina";
import { canMeasure, CLOCK_TICKS, PAGE_BYTES, sampleChildren, summarize, type Sample, type Usage } from "./processos";

const ROOT = new URL("../../", import.meta.url);
/** A fala padrão: os dois avisos gravados em pt-BR que já estão no repositório, juntos e completados até 10 s. */
const DEFAULT_SPEECH = ["apps/voice/assets/unavailable-notice/pt-BR.wav", "apps/voice/assets/ivr-notice/pt-BR/no-choice.wav"];
const SPEAK_SECONDS = 10;
const LISTEN_SECONDS = 30;
const VOICE_RATE = 8000;

export interface ProbeOptions {
  link: string;
  name: string;
  hostPresent: boolean;
  speech: string[];
  lobbyWaitSeconds: number;
  outDir: string;
  headed: boolean;
}

export function parseOptions(argv: string[]): ProbeOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      nome: { type: "string", default: "Sonda DeskVoice" },
      "anfitriao-presente": { type: "boolean", default: false },
      fala: { type: "string", multiple: true },
      "espera-lobby": { type: "string", default: "300" },
      saida: { type: "string" },
      "com-tela": { type: "boolean", default: false },
    },
  });
  const lobby = Number(values["espera-lobby"]);
  if (!Number.isInteger(lobby) || lobby < 10 || lobby > 1800) throw new Error("--espera-lobby vai de 10 a 1800 segundos");
  return {
    link: positionals[0] ?? "",
    name: displayName(values.nome),
    hostPresent: values["anfitriao-presente"],
    speech: values.fala?.length ? values.fala : DEFAULT_SPEECH.map((file) => new URL(file, ROOT).pathname),
    lobbyWaitSeconds: lobby,
    outDir: values.saida ?? mkdtempSync(path.join(tmpdir(), "sonda-reuniao-")),
    headed: values["com-tela"],
  };
}

/** Recusa antes de abrir qualquer navegador. Devolve o motivo, ou null quando pode seguir. */
export function refusal(options: ProbeOptions): string | null {
  if (!meetingCode(options.link)) return "o link precisa ser de uma reunião do Meet: https://meet.google.com/abc-defg-hij";
  if (!options.hostPresent) return "falta --anfitriao-presente: a sonda só roda numa reunião nossa, com o anfitrião na sala para admitir (pedido 3 do desenho)";
  return null;
}

export interface ProbeReport {
  platform: "meet";
  meeting: string;
  displayName: string;
  browser: { version: string; headless: boolean };
  admission: { result: Admission; askedAtMs?: number; answeredAtMs?: number; waitMs?: number };
  steps: Step[];
  sent?: { file: string; stats: AudioStats };
  heard?: { fileNative: string; file8k: string; stats: AudioStats; stats8k: AudioStats };
  rtc?: RtcNumbers;
  resources: { whileWaiting: Usage | null; inMeeting: Usage | null; note: string };
  humanCheck: string[];
  notMeasured: string[];
}

export async function runProbe(options: ProbeOptions): Promise<ProbeReport> {
  const started = performance.now();
  const now = (): number => Math.round(performance.now() - started);
  mkdirSync(options.outDir, { recursive: true });
  const out = (file: string): string => path.join(options.outDir, file);
  const speech: Pcm = fitTo(concat(options.speech.map((file) => readWav(readFileSync(file)))), SPEAK_SECONDS);
  writeFileSync(out("enviada.wav"), writeWav(speech));

  const steps: Step[] = [];
  const samples: Array<Sample & { phase: "waiting" | "meeting" }> = [];
  let phase: "waiting" | "meeting" = "waiting";
  const measuring = canMeasure();
  const timer = measuring ? setInterval(() => samples.push({ ...sampleChildren(now()), phase }), 1000) : undefined;

  const { chromium } = loadPlaywright();
  const browser = await chromium
    .launch({
      headless: !options.headed,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--lang=pt-BR"],
    })
    .catch((error: unknown) => {
      if (timer) clearInterval(timer);
      throw error;
    });
  const report: ProbeReport = {
    platform: "meet",
    meeting: maskCode(meetingCode(options.link)!),
    displayName: options.name,
    browser: { version: browser.version(), headless: !options.headed },
    admission: { result: "no_join_button" },
    steps,
    resources: { whileWaiting: null, inMeeting: null, note: "" },
    humanCheck: [
      `O anfitrião ouviu na reunião os ${SPEAK_SECONDS} s de fala (os dois avisos gravados em pt-BR, ou o --fala)? Sim ou não, e se cortou.`,
      `Quem rodou ouviu ${out("escuta-8k.wav")} e reconhece a fala do anfitrião? E em ${out("escuta-original.wav")} (a taxa do navegador), a diferença pesa?`,
    ],
    notMeasured: [],
  };
  try {
    const context = await browser.newContext({ locale: "pt-BR", permissions: ["microphone", "camera"] });
    await context.addInitScript({ content: pageScript() });
    const page = await context.newPage();
    report.admission.result = await join(page, options.link, options.name, options.lobbyWaitSeconds * 1000, now, steps);
    const asked = steps.find((s) => s.name === "pediu_para_entrar" && s.ok);
    const answered = steps.find((s) => s.name === "resposta_do_anfitriao");
    if (asked) report.admission.askedAtMs = asked.atMs;
    if (asked && answered) Object.assign(report.admission, { answeredAtMs: answered.atMs, waitMs: answered.atMs - asked.atMs });
    if (report.admission.result !== "admitted") {
      await page.screenshot({ path: out("falha.png") }).catch(() => undefined);
      return report;
    }
    phase = "meeting";
    await page.evaluate(() => window.__sonda!.startRecording());
    const listenStarted = performance.now();
    await page.evaluate(([b64, rate]: readonly [string, number]) => window.__sonda!.play(b64, rate), [Buffer.from(speech.samples.buffer, speech.samples.byteOffset, speech.samples.byteLength).toString("base64"), speech.sampleRate] as const);
    steps.push({ name: "tocou_a_fala", atMs: now(), ok: true });
    await page.waitForTimeout(Math.max(0, LISTEN_SECONDS * 1000 - (performance.now() - listenStarted)));
    const capture = await page.evaluate(() => window.__sonda!.stopRecording());
    report.rtc = await page.evaluate(() => window.__sonda!.rtc());
    const raw = Buffer.from(capture.base64, "base64");
    const heard: Pcm = { sampleRate: capture.sampleRate, samples: new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2) };
    const heard8k = downsample(heard, VOICE_RATE);
    writeFileSync(out("escuta-original.wav"), writeWav(heard));
    writeFileSync(out("escuta-8k.wav"), writeWav(heard8k));
    report.sent = { file: out("enviada.wav"), stats: audioStats(speech) };
    report.heard = { fileNative: out("escuta-original.wav"), file8k: out("escuta-8k.wav"), stats: audioStats(heard), stats8k: audioStats(heard8k) };
    steps.push({ name: "gravou_a_escuta", atMs: now(), ok: heard.samples.length > 0, detail: `${capture.sampleRate} Hz` });
    steps.push({ name: "saiu", atMs: now(), ok: await leave(page) });
  } finally {
    if (timer) clearInterval(timer);
    await browser.close();
    report.resources = {
      whileWaiting: summarize(samples.filter((s) => s.phase === "waiting")),
      inMeeting: summarize(samples.filter((s) => s.phase === "meeting")),
      note: measuring
        ? `soma dos processos filhos da sonda, a cada 1 s; CPU em % de um núcleo (${CLOCK_TICKS} tiques/s), memória pela soma do RSS (página de ${PAGE_BYTES} bytes), que conta duas vezes a memória dividida entre os processos: é o teto, não a medida exata`
        : "não medido: sem /proc (fora do Linux)",
    };
    report.notMeasured = [
      "se a fala é inteligível: os números de áudio dizem só que havia som, e o ouvido humano decide",
      "o atraso de ponta a ponta (fala do anfitrião até o arquivo)",
      "o chat da reunião e o aviso falado da seção 6 (fatia 2a)",
      "reunião com mais de uma pessoa além da sonda, e entrada sem a página em pt-BR",
      ...(measuring ? [] : ["CPU e memória"]),
    ];
    writeFileSync(out("relatorio.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function main(): Promise<number> {
  let options: ProbeOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`sonda-reuniao: ${(error as Error).message}\n`);
    return 2;
  }
  const reason = refusal(options);
  if (reason) {
    process.stderr.write(`sonda-reuniao: ${reason}\n`);
    return 2;
  }
  const report = await runProbe(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`\nArquivos em ${options.outDir}. Falta o ouvido humano:\n- ${report.humanCheck.join("\n- ")}\n`);
  return report.admission.result === "admitted" && report.heard ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
