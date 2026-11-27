import { describe, expect, it } from "vitest";
import { audioStats, concat, downsample, fitTo, readWav, writeWav } from "./audio";
import { displayName, maskCode, meetingCode } from "./meet";
import { descendants, parseStat, summarize } from "./processos";
import { parseOptions, refusal } from "./sonda";

const tone = (rate: number, seconds: number, amplitude: number, hz = 440): Int16Array =>
  Int16Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / rate)));

describe("o link aceito", () => {
  it("aceita só o endereço de uma reunião do Meet", () => {
    expect(meetingCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
    for (const bad of [
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "https://evil.example/https://meet.google.com/abc-defg-hij",
      "https://user@meet.google.com/abc-defg-hij",
      "https://meet.google.com:8443/abc-defg-hij",
      "https://meet.google.com/landing",
      "https://meet.google.com/abc-defg-hij/extra",
      "https://teams.microsoft.com/l/meetup-join/x",
      "não é link",
    ]) expect(meetingCode(bad), bad).toBeNull();
  });

  it("o relatório mostra só as pontas do código", () => {
    expect(maskCode("abc-defg-hij")).toBe("abc-****-hij");
  });
});

describe("o nome de exibição", () => {
  it("sempre termina com (IA), sem duplicar", () => {
    expect(displayName("Lia")).toBe("Lia (IA)");
    expect(displayName("Lia (IA)")).toBe("Lia (IA)");
    expect(displayName("Lia (ia) ")).toBe("Lia (IA)");
    expect(displayName("  ")).toBe("Sonda DeskVoice (IA)");
  });
});

describe("a recusa antes do navegador", () => {
  const link = "https://meet.google.com/abc-defg-hij";
  it("sem --anfitriao-presente não anda", () => {
    expect(refusal(parseOptions([link, "--saida", "/tmp/nao-usada"]))).toMatch(/anfitriao-presente/);
    expect(refusal(parseOptions([link, "--anfitriao-presente", "--saida", "/tmp/nao-usada"]))).toBeNull();
  });
  it("link fora do Meet não anda, mesmo com o anfitrião", () => {
    expect(refusal(parseOptions(["https://example.com/x", "--anfitriao-presente", "--saida", "/tmp/nao-usada"]))).toMatch(/meet\.google\.com/);
  });
  it("a espera do lobby tem limite", () => {
    expect(() => parseOptions([link, "--espera-lobby", "5", "--saida", "/tmp/nao-usada"])).toThrow(/10 a 1800/);
    expect(parseOptions([link, "--nome", "Lia", "--saida", "/tmp/nao-usada"]).name).toBe("Lia (IA)");
  });
});

describe("o áudio", () => {
  it("escreve e lê de volta o mesmo WAV, e mistura estéreo em mono", () => {
    const samples = tone(8000, 0.1, 10000);
    expect(readWav(writeWav({ sampleRate: 8000, samples }))).toEqual({ sampleRate: 8000, samples });
    const stereo = writeWav({ sampleRate: 8000, samples: Int16Array.from([100, 300, -50, -150]) });
    stereo.writeUInt16LE(2, 22); // dois canais, dois quadros
    expect(Array.from(readWav(stereo).samples)).toEqual([200, -100]);
  });

  it("recusa WAV que não é PCM16", () => {
    const wav = writeWav({ sampleRate: 8000, samples: new Int16Array(4) });
    wav.writeUInt16LE(8, 34);
    expect(() => readWav(wav)).toThrow(/16 bits/);
    expect(() => readWav(Buffer.from("nada disso"))).toThrow(/RIFF/);
  });

  it("desce 48 kHz e 44,1 kHz para 8 kHz mantendo a duração e o nível de uma fala grave", () => {
    for (const rate of [48000, 44100]) {
      const down = downsample({ sampleRate: rate, samples: tone(rate, 1, 8000, 300) }, 8000);
      expect(down.sampleRate).toBe(8000);
      expect(Math.abs(down.samples.length - 8000)).toBeLessThanOrEqual(1);
      expect(Math.abs((audioStats(down).rmsDbfs ?? 0) - (audioStats({ sampleRate: rate, samples: tone(rate, 1, 8000, 300) }).rmsDbfs ?? 0))).toBeLessThan(0.5);
    }
  });

  it("um tom acima de 4 kHz some na descida (não volta dobrado como som grave)", () => {
    const down = downsample({ sampleRate: 48000, samples: tone(48000, 1, 8000, 6000) }, 8000);
    expect(audioStats(down).rmsDbfs ?? -Infinity).toBeLessThan(-40);
  });

  it("junta as falas e completa com silêncio até a duração pedida", () => {
    const joined = concat([{ sampleRate: 8000, samples: tone(8000, 1, 5000) }, { sampleRate: 8000, samples: tone(8000, 2, 5000) }]);
    const fitted = fitTo(joined, 10);
    expect(fitted.samples.length).toBe(80000);
    expect(audioStats(fitted).activeFraction).toBeCloseTo(0.3, 2);
    expect(() => concat([{ sampleRate: 8000, samples: new Int16Array(1) }, { sampleRate: 16000, samples: new Int16Array(1) }])).toThrow(/mesma taxa/);
  });

  it("silêncio digital não tem nível, e som estourado aparece", () => {
    expect(audioStats({ sampleRate: 8000, samples: new Int16Array(8000) })).toEqual({ seconds: 1, rmsDbfs: null, peakDbfs: null, activeFraction: 0, clippedFraction: 0 });
    const loud = audioStats({ sampleRate: 8000, samples: Int16Array.from({ length: 800 }, (_, i) => (i % 2 ? 32767 : -32768)) });
    expect(loud.clippedFraction).toBe(1);
    expect(loud.activeFraction).toBe(1);
  });
});

describe("CPU e memória", () => {
  it("lê o /proc/<pid>/stat mesmo com espaço e parêntese no nome", () => {
    const rest = ["S", "41", ...Array(9).fill("0"), "120", "30", ...Array(8).fill("0"), "2500"].join(" ");
    expect(parseStat(`99 (chrome (renderer) x) ${rest}`)).toEqual({ ppid: 41, ticks: 150, rssPages: 2500 });
    expect(parseStat("lixo")).toBeNull();
  });

  it("soma os netos, não os irmãos", () => {
    const stats = new Map([[2, { ppid: 1 }], [3, { ppid: 2 }], [4, { ppid: 3 }], [5, { ppid: 9 }]]);
    expect(descendants(1, stats).sort()).toEqual([2, 3, 4]);
  });

  it("CPU em % de um núcleo entre leituras, memória máxima e média", () => {
    const usage = summarize([
      { atMs: 0, ticks: 0, rssBytes: 100 * 1024 * 1024 },
      { atMs: 1000, ticks: 50, rssBytes: 200 * 1024 * 1024 },
      { atMs: 2000, ticks: 200, rssBytes: 300 * 1024 * 1024 },
    ]);
    expect(usage).toEqual({ samples: 3, cpuMeanPercent: 100, cpuMaxPercent: 150, rssMaxMb: 300, rssMeanMb: 200 });
    expect(summarize([{ atMs: 0, ticks: 0, rssBytes: 0 }])).toBeNull();
  });
});
