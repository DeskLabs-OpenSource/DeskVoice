const costs = {
  title: "Custos",
  lead: "Quanto os agentes gastaram com os provedores de voz.",
  period: "Período",
  lastDays: "Últimos {n} dias",
  total: "Total no período",
  estimate: "Os valores são uma estimativa, calculada com o preço público de cada provedor na data indicada. O valor que vale é o da fatura do provedor.",
  empty: "Nenhum custo registrado neste período. Ele aparece aqui quando uma chamada com motor de voz pago termina.",
  byDay: "Por dia",
  byAgent: "Por agente",
  byEngine: "Por motor de voz",
  calls: "Chamadas: {n}",
  minutes: "{n} min",
  priceChecked: "Preço conferido em {date}",
  priceSource: "Fonte do preço",
  deletedAgent: "Agente apagado",
};

export default costs;
export type CostsDictionary = typeof costs;
