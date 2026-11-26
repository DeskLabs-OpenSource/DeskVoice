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
  /** A linha do analista ao vivo. `{model}` é o nome do modelo de decisão. */
  analystLine: "Analista · {model}",
  analystNote: "Pedidos do analista ao vivo, a cada fala de quem ligou",
  /** A linha de uma peça separada do motor, como as do pipeline (fatia 5c). `{piece}` é qual peça; `{label}`, o nome dela. */
  pieceLine: "{piece} · {label}",
  pieces: { transcriber: "Transcrição", brain: "Cérebro", synthesizer: "Voz" },
  pieceNote: "Peça separada do motor (como as do pipeline): o custo vem do consumo dela (minutos ouvidos, tokens ou caracteres).",
  /** A linha dos testes do agente (fatia 7c). `{engine}` é o nome do motor. */
  testLine: "Testes · {engine}",
  testNote: "Rodadas dos testes do agente, em texto",
  minutes: "{n} min",
  priceChecked: "Preço conferido em {date}",
  priceSource: "Fonte do preço",
  deletedAgent: "Agente apagado",
  handoffCounts: "Uma ligação com passagem conta para cada agente.",
  unmeasured: "Não medido",
  unmeasuredPart: "+ parte não medida",
  unmeasuredNote: "{n} linhas do extrato deste período não têm custo medido: o modelo não tem preço conhecido, ou o consumo não pôde ser medido. O gasto delas não entra nos valores abaixo. Ele aparece só na fatura do provedor.",
  unmeasuredNoteOne: "1 linha do extrato deste período não tem custo medido: o modelo não tem preço conhecido, ou o consumo não pôde ser medido. O gasto dela não entra nos valores abaixo. Ele aparece só na fatura do provedor.",
  includesEstimate: "inclui estimativa",
  estimatedNote: "{n} linhas do extrato deste período têm custo estimado, porque o consumo daquela leitura não foi lido. A estimativa conta no total e no teto, e é feita para ficar acima do real.",
  estimatedNoteOne: "1 linha do extrato deste período tem custo estimado, porque o consumo daquela leitura não foi lido. A estimativa conta no total e no teto, e é feita para ficar acima do real.",
};

export default costs;
export type CostsDictionary = typeof costs;
