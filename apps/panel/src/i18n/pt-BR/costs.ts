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
  handoffCounts: "Uma ligação com passagem conta para cada agente.",
  unmeasured: "Não medido",
  unmeasuredPart: "+ parte não medida",
  unmeasuredNote: "{n} ligações deste período têm custo não medido: foram lidas por um modelo sem preço conhecido, e o gasto delas não entra nos valores abaixo. Ele aparece só na fatura do provedor.",
  unmeasuredNoteOne: "1 ligação deste período tem custo não medido: foi lida por um modelo sem preço conhecido, e o gasto dela não entra nos valores abaixo. Ele aparece só na fatura do provedor.",
};

export default costs;
export type CostsDictionary = typeof costs;
