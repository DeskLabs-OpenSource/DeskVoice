import type { CostsDictionary } from "../pt-BR/costs";

const costs: CostsDictionary = {
  title: "Costos",
  lead: "Cuánto gastaron los agentes con los proveedores de voz.",
  period: "Período",
  lastDays: "Últimos {n} días",
  total: "Total en el período",
  estimate: "Los valores son una estimación, calculada con el precio público de cada proveedor en la fecha indicada. El valor que vale es el de la factura del proveedor.",
  empty: "Ningún costo registrado en este período. Aparece aquí cuando termina una llamada con motor de voz pago.",
  byDay: "Por día",
  byAgent: "Por agente",
  byEngine: "Por motor de voz",
  calls: "Llamadas: {n}",
  minutes: "{n} min",
  priceChecked: "Precio revisado el {date}",
  priceSource: "Fuente del precio",
  deletedAgent: "Agente borrado",
  handoffCounts: "Una llamada que se pasó a otro agente cuenta para cada agente.",
  unmeasured: "No medido",
  unmeasuredPart: "+ parte no medida",
  unmeasuredNote: "{n} llamadas de este período tienen costo no medido: las leyó un modelo sin precio conocido, y lo que costaron no está en los valores de abajo. Solo aparece en la factura del proveedor.",
  unmeasuredNoteOne: "1 llamada de este período tiene costo no medido: la leyó un modelo sin precio conocido, y lo que costó no está en los valores de abajo. Solo aparece en la factura del proveedor.",
};

export default costs;
