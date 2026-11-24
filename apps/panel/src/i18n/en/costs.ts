import type { CostsDictionary } from "../pt-BR/costs";

const costs: CostsDictionary = {
  title: "Costs",
  lead: "How much the agents spent with the voice providers.",
  period: "Period",
  lastDays: "Last {n} days",
  total: "Total in the period",
  estimate: "The amounts are an estimate, computed from each provider's public price on the date shown. The amount that counts is the one on the provider's invoice.",
  empty: "No cost recorded in this period. It shows up here when a call on a paid voice engine ends.",
  byDay: "By day",
  byAgent: "By agent",
  byEngine: "By voice engine",
  calls: "Calls: {n}",
  analystLine: "Analyst · {model}",
  analystNote: "Live analyst requests, on each caller turn",
  /** A linha de uma peça separada do motor, como as do pipeline (fatia 5c). `{piece}` é qual peça; `{label}`, o nome dela. */
  pieceLine: "{piece} · {label}",
  pieces: { transcriber: "Transcription", brain: "Brain", synthesizer: "Voice" },
  pieceNote: "A piece apart from the engine (like those of the pipeline): the cost comes from its own usage (minutes heard, tokens or characters).",
  minutes: "{n} min",
  priceChecked: "Price checked on {date}",
  priceSource: "Price source",
  deletedAgent: "Deleted agent",
  handoffCounts: "A call that was handed off counts for each agent.",
  unmeasured: "Not measured",
  unmeasuredPart: "+ part not measured",
  unmeasuredNote: "{n} usage lines in this period have no measured cost: the model has no known price, or the usage could not be measured. What they cost is not in the values below. It only shows on the provider's bill.",
  unmeasuredNoteOne: "1 usage line in this period has no measured cost: the model has no known price, or the usage could not be measured. What it cost is not in the values below. It only shows on the provider's bill.",
  includesEstimate: "includes estimate",
  estimatedNote: "{n} usage lines in this period have an estimated cost, because the usage of that reading was not read. The estimate counts in the total and in the ceiling, and is made to stay above the real cost.",
  estimatedNoteOne: "1 usage line in this period has an estimated cost, because the usage of that reading was not read. The estimate counts in the total and in the ceiling, and is made to stay above the real cost.",
};

export default costs;
