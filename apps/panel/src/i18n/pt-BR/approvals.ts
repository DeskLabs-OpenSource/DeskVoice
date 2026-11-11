const approvals = {
  title: "Aprovações",
  lead: "Pedidos que um agente fez no meio de uma ligação. Enquanto você não responde, a pessoa espera na linha.",
  emptyTitle: "Nenhum pedido esperando resposta.",
  emptyBody: "Quando um agente precisar da sua decisão durante uma ligação, o pedido aparece aqui e no topo de qualquer tela, com o tempo que resta.",
  approve: "Aprovar",
  deny: "Negar",
  timeLeft: "Restam",
  ifNoAnswer: {
    approved: "Sem resposta no prazo, o agente segue como se você tivesse aprovado.",
    denied: "Sem resposta no prazo, o agente segue como se você tivesse negado.",
  },
  onTheLine: "Na linha",
  agent: "Agente",
  openCall: "Ver a ligação",
  bannerWaiting: "Há uma pessoa na linha esperando esta resposta.",
  bannerMore: "Ver todos os pedidos ({n})",
  historyTitle: "Decisões recentes",
  status: { pending: "Esperando resposta", approved: "Aprovado", denied: "Negado", expired: "Sem resposta no prazo" },
  decidedBy: "por {name}",
};

export default approvals;
export type ApprovalsDictionary = typeof approvals;
