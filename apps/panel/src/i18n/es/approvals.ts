import type { ApprovalsDictionary } from "../pt-BR/approvals";

const approvals: ApprovalsDictionary = {
  title: "Aprobaciones",
  lead: "Pedidos que un agente hizo en medio de una llamada. Mientras no respondes, la persona espera en la línea.",
  emptyTitle: "Ningún pedido espera respuesta.",
  emptyBody: "Cuando un agente necesite tu decisión durante una llamada, el pedido aparece aquí y arriba de cualquier pantalla, con el tiempo que queda.",
  approve: "Aprobar",
  deny: "Negar",
  timeLeft: "Quedan",
  ifNoAnswer: {
    approved: "Sin respuesta a tiempo, el agente sigue como si hubieras aprobado.",
    denied: "Sin respuesta a tiempo, el agente sigue como si hubieras negado.",
  },
  onTheLine: "En la línea",
  agent: "Agente",
  openCall: "Ver la llamada",
  bannerWaiting: "Hay una persona en la línea esperando esta respuesta.",
  bannerMore: "Ver todos los pedidos ({n})",
  historyTitle: "Decisiones recientes",
  status: { pending: "Esperando respuesta", approved: "Aprobado", denied: "Negado", expired: "Sin respuesta a tiempo" },
  decidedBy: "por {name}",
};

export default approvals;
