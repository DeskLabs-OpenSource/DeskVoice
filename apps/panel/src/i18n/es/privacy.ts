import type { PrivacyDictionary } from "../pt-BR/privacy";

const privacy: PrivacyDictionary = {
  retentionTitle: "Plazo de conservación de las conversaciones",
  retentionLead:
    "La transcripción de cada llamada, lo que dijeron quien llamó y el agente, queda en la base de datos hasta salir del plazo. Después, el texto se reemplaza por una marca; la llamada, la hora, el resumen y el resto de la línea de tiempo se mantienen.",
  retentionDays: "Conservar durante (días)",
  retentionHint: "Vacío conserva para siempre. El plazo mínimo es de {min} días.",
  currentForever: "Hoy esta organización conserva la transcripción para siempre.",
  currentDays: "Hoy esta organización conserva la transcripción durante {days} días.",
  irreversible:
    "El texto que sale no vuelve, ni por este panel ni por el servidor. Las copias de seguridad ya hechas mantienen el texto hasta ser descartadas. El resumen de la llamada y los datos enviados por las herramientas no salen con el plazo.",
  save: "Guardar plazo",
  confirmTitle: "¿Borrar el texto de las conversaciones de más de {days} días?",
  confirmBody:
    "El texto de esas conversaciones sale de la base de datos en unos instantes, y desde entonces una vez al día. Lo que sale no vuelve. Las copias de seguridad ya hechas mantienen el texto hasta ser descartadas.",
  confirmYes: "Borrar y conservar durante {days} días",
  exportTitle: "Datos de una persona que llamó",
  exportLead:
    "Cuando alguien pide lo que la central guarda sobre ella, ingrese el teléfono. Sale un archivo con las llamadas de ese número en esta organización, sus eventos y la entrada en la lista de no llamar. Lo dicho que ya salió por el plazo aparece como borrado.",
  exportPhone: "Teléfono",
  exportPhoneHint: "La búsqueda es por número. Si la persona llamó desde otro teléfono, exporte cada uno.",
  exportRun: "Exportar",
  exportDone: "Archivo de {phone} descargado. Llamadas: {calls}. Eventos: {events}.",
  exportDoneDnc: "El número está en la lista de no llamar, y eso también está en el archivo.",
  exportEmpty: "Esta organización no tiene registro de {phone}. No se descargó ningún archivo, y la consulta quedó en el registro de abajo.",
  exportCare: "El archivo contiene datos personales. Entréguelo por el canal acordado con la persona y borre la copia de esta computadora después.",
  fileName: "datos-{phone}-{date}.ndjson",
  historyTitle: "Registro",
  historyLead: "Quién cambió el plazo, qué salió por el plazo y quién exportó los datos de qué teléfono. Los 50 más recientes.",
  historyEmpty: "Nada registrado todavía.",
  history: {
    transcript_retention_changed: "{who} cambió el plazo de conservación de {from} a {to}.",
    transcripts_purged: "El texto de lo dicho hace más de {days} días fue borrado por el plazo. Fragmentos borrados: {count}.",
    caller_data_exported: "{who} exportó los datos de {phone}. Llamadas: {calls}. Eventos: {events}.",
  },
  forever: "para siempre",
  days: "{n} días",
  removedPerson: "Una persona que salió del equipo",
};

export default privacy;
