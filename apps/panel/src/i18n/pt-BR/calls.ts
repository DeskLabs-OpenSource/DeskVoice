const calls = {
  title: "Chamadas",
  lead: "O que os seus agentes estão atendendo agora e o que já atenderam.",
  simulate: "Simular uma chamada",
  talk: "Falar com o agente",
  liveTitle: "Agora",
  liveNone: "Nenhuma chamada em andamento.",
  follow: "Acompanhar",
  historyTitle: "Histórico",
  filterLabel: "Filtrar por estado",
  filterAll: "Todas",
  emptyFilter: "Nenhuma chamada com este estado.",
  columns: { caller: "Número", agent: "Agente", status: "Estado", started: "Início", duration: "Duração", cost: "Custo" },
  direction: { inbound: "Recebida", outbound: "Feita pelo agente" },
  empty: {
    title: "Nenhuma chamada ainda.",
    body: "Para receber a primeira ligação faltam os passos abaixo. Enquanto isso, veja o sistema funcionando com uma chamada simulada: ela não usa linha telefônica nem chave de IA.",
    steps: { agent: "Criar um agente", line: "Conectar a linha telefônica", engine: "Cadastrar a chave de um motor de voz" },
    done: "Feito",
    todo: "Falta",
  },
  demoAgent: {
    name: "Agente de demonstração",
    role: "Recepção",
    greeting: "Olá, você ligou para a demonstração do DeskVoice.",
    instructions: "Atenda com cordialidade e mostre como o DeskVoice funciona.",
  },
};

export default calls;
export type CallsDictionary = typeof calls;
