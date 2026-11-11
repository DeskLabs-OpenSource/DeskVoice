import type { Clock } from "./types";

/** Único lugar do produto que lê o relógio da máquina. O resto recebe um `Clock` ou um `Date`. */
export const systemClock: Clock = { now: () => new Date() };
