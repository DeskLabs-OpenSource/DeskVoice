import type { CallsDictionary } from "../pt-BR/calls";

const calls: CallsDictionary = {
  title: "Llamadas",
  lead: "Lo que tus agentes están atendiendo ahora y lo que ya atendieron.",
  simulate: "Simular una llamada",
  talk: "Hablar con el agente",
  liveTitle: "Ahora",
  liveNone: "Ninguna llamada en curso.",
  follow: "Seguir",
  historyTitle: "Historial",
  filterLabel: "Filtrar por estado",
  filterAll: "Todas",
  emptyFilter: "Ninguna llamada con este estado.",
  columns: { caller: "Número", agent: "Agente", status: "Estado", started: "Inicio", duration: "Duración", cost: "Costo", score: "Nota" },
  score: "{score}/10",
  noScore: "Sin análisis",
  direction: { inbound: "Recibida", outbound: "Hecha por el agente" },
  empty: {
    title: "Todavía no hay llamadas.",
    body: "Para recibir la primera llamada faltan los pasos de abajo. Mientras tanto, mira el sistema funcionando con una llamada simulada: no usa línea telefónica ni clave de IA.",
    steps: { agent: "Crear un agente", line: "Conectar la línea telefónica", engine: "Registrar la clave de un motor de voz" },
    done: "Hecho",
    todo: "Falta",
  },
  demoAgent: {
    name: "Agente de demostración",
    role: "Recepción",
    greeting: "Hola, llamaste a la demostración de DeskVoice.",
    instructions: "Atiende con cordialidad y muestra cómo funciona DeskVoice.",
  },
};

export default calls;
