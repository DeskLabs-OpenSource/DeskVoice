import type { PrivacyDictionary } from "../pt-BR/privacy";

const privacy: PrivacyDictionary = {
  recordingTitle: "Grabación de las llamadas",
  recordingLead:
    "Graba el audio de cada llamada de esta organización en un archivo, que se escucha en la pantalla de la llamada: quien llamó en un canal, el agente en el otro. Viene apagada. Vale desde la próxima llamada.",
  recordingSwitch: "Grabar el audio de las llamadas",
  recordingDisk:
    "Cada minuto de llamada ocupa cerca de 1,9 MB en el disco del servidor. Es la cuenta del formato (dos canales, 8 kHz, 16 bits), y no una medición.",
  recordingKeeps:
    "Encender o apagar no borra nada. Las grabaciones ya hechas siguen el plazo de conservación de abajo: salen junto con el texto de la conversación, y sin plazo se conservan para siempre. Las copias de seguridad de hoy no incluyen las grabaciones. Verifique que el aviso del inicio de la llamada diga a quien llama que la conversación queda registrada.",
  recordingForever:
    "El plazo de conservación está vacío: las grabaciones se conservan para siempre, y el disco del servidor crece sin límite, cerca de 1,9 MB por minuto de llamada. Defina un plazo abajo para que las grabaciones antiguas salgan.",
  recordingStates: { on: "encendida", off: "apagada" },
  retentionTitle: "Plazo de conservación de las conversaciones",
  retentionLead:
    "La transcripción de cada llamada, lo que dijeron quien llamó y el agente, queda en la base de datos hasta salir del plazo. Después, el texto se reemplaza por una marca y la grabación, si la hay, se borra; la llamada, la hora, el resumen y el resto de la línea de tiempo se mantienen. Los pendientes cerrados hace más tiempo que el plazo, contado desde el cierre, también se borran; el pendiente abierto queda hasta que alguien lo cierre.",
  retentionDays: "Conservar durante (días)",
  retentionHint: "Vacío conserva para siempre. El plazo mínimo es de {min} días.",
  currentForever: "Hoy esta organización conserva la transcripción para siempre.",
  currentDays: "Hoy esta organización conserva la transcripción durante {days} días.",
  irreversible:
    "El texto que sale no vuelve, ni por este panel ni por el servidor. Las copias de seguridad ya hechas mantienen el texto hasta ser descartadas. El resumen de la llamada y los datos enviados por las herramientas no salen con el plazo.",
  save: "Guardar plazo",
  confirmTitle: "¿Borrar el texto de las conversaciones de más de {days} días?",
  confirmBody:
    "El texto de esas conversaciones sale de la base de datos en unos instantes, y desde entonces una vez al día; su grabación, si la hay, sale junto. Lo que sale no vuelve. Las copias de seguridad ya hechas mantienen el texto hasta ser descartadas.",
  confirmYes: "Borrar y conservar durante {days} días",
  exportTitle: "Datos de una persona que llamó",
  exportLead:
    "Cuando alguien pide lo que la central guarda sobre ella, ingrese el teléfono. Sale un archivo con las llamadas de ese número en esta organización, sus eventos, los pendientes de ese número, abiertos y cerrados, y la entrada en la lista de no llamar. Lo dicho que ya salió por el plazo aparece como borrado. Cada llamada dice si tiene grabación; el audio no va en el archivo y se escucha en la pantalla de la llamada.",
  exportPhone: "Teléfono",
  exportPhoneHint: "La búsqueda es por número. Si la persona llamó desde otro teléfono, exporte cada uno.",
  exportRun: "Exportar",
  exportDone: "Archivo de {phone} descargado. Llamadas: {calls}. Eventos: {events}.",
  exportDoneFollowUps: "Pendientes: {count}.",
  exportDoneDnc: "El número está en la lista de no llamar, y eso también está en el archivo.",
  exportEmpty: "Esta organización no tiene registro de {phone}. No se descargó ningún archivo, y la consulta quedó en el registro de abajo.",
  exportCare: "El archivo contiene datos personales. Entréguelo por el canal acordado con la persona y borre la copia de esta computadora después.",
  fileName: "datos-{phone}-{date}.ndjson",
  historyTitle: "Registro",
  historyLead: "Quién cambió el plazo o la grabación, qué salió por el plazo y quién exportó los datos de qué teléfono. Los 50 más recientes.",
  historyEmpty: "Nada registrado todavía.",
  history: {
    transcript_retention_changed: "{who} cambió el plazo de conservación de {from} a {to}.",
    transcripts_purged: "El texto de lo dicho hace más de {days} días fue borrado por el plazo. Fragmentos borrados: {count}.",
    caller_data_exported: "{who} exportó los datos de {phone}. Llamadas: {calls}. Eventos: {events}.",
    call_recording_changed: "{who} dejó la grabación de las llamadas {state}.",
  },
  purgedRecordings: "Grabaciones borradas: {count}.",
  purgedFollowUps: "Pendientes cerrados borrados: {count}.",
  forever: "para siempre",
  days: "{n} días",
  removedPerson: "Una persona que salió del equipo",
};

export default privacy;
