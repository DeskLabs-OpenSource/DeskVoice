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
  minutes: "{n} min",
  priceChecked: "Price checked on {date}",
  priceSource: "Price source",
  deletedAgent: "Deleted agent",
  handoffCounts: "A call that was handed off counts for each agent.",
  unmeasured: "Not measured",
  unmeasuredPart: "+ part not measured",
  unmeasuredNote: "{n} calls in this period have an unmeasured cost: they were read by a model with no known price, and what they cost is not in the values below. It only shows on the provider's bill.",
  unmeasuredNoteOne: "1 call in this period has an unmeasured cost: it was read by a model with no known price, and what it cost is not in the values below. It only shows on the provider's bill.",
};

export default costs;
