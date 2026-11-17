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
  analystLine: "Analista · {model}",
  analystNote: "Pedidos del analista en vivo, en cada intervención de quien llamó",
  minutes: "{n} min",
  priceChecked: "Precio revisado el {date}",
  priceSource: "Fuente del precio",
  deletedAgent: "Agente borrado",
  handoffCounts: "Una llamada que se pasó a otro agente cuenta para cada agente.",
  unmeasured: "No medido",
  unmeasuredPart: "+ parte no medida",
  unmeasuredNote: "{n} líneas del extracto de este período no tienen costo medido: el modelo no tiene precio conocido, o el consumo no pudo medirse. Lo que costaron no está en los valores de abajo. Solo aparece en la factura del proveedor.",
  unmeasuredNoteOne: "1 línea del extracto de este período no tiene costo medido: el modelo no tiene precio conocido, o el consumo no pudo medirse. Lo que costó no está en los valores de abajo. Solo aparece en la factura del proveedor.",
  includesEstimate: "incluye estimación",
  estimatedNote: "{n} líneas del extracto de este período tienen costo estimado, porque el consumo de esa lectura no se leyó. La estimación cuenta en el total y en el tope, y está hecha para quedar por encima del real.",
  estimatedNoteOne: "1 línea del extracto de este período tiene costo estimado, porque el consumo de esa lectura no se leyó. La estimación cuenta en el total y en el tope, y está hecha para quedar por encima del real.",
};

export default costs;
