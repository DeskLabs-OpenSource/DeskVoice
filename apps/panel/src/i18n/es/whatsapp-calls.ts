import type { WhatsAppCallsDictionary } from "../pt-BR/whatsapp-calls";

const whatsappCalls: WhatsAppCallsDictionary = {
  title: "Llamadas por WhatsApp",
  lead: "Conecta el número de la empresa leyendo un código QR, como un dispositivo más de WhatsApp. Es por él que el agente va a atender a quien llama por WhatsApp.",
  nextVersion:
    "En esta versión el servicio solo conecta el número. La atención de las llamadas por el agente llega en la próxima versión; hasta entonces, quien llama por WhatsApp es atendido como hoy, en el teléfono.",
  unavailable: "El proceso de voz de este servidor todavía no tiene la clave del servicio de llamadas por WhatsApp. Esto ocurre cuando la actualización la hizo un actualizador antiguo. Ejecuta en el servidor, una vez:",
  serviceAbsent: "El servicio de llamadas por WhatsApp no está instalado en este servidor.",
  serviceCost:
    "Es una pieza aparte, que solo se descarga y se enciende si lo pides. La imagen tiene cerca de 19 MB para descargar (verificado en el registro de imágenes el 12/11/2026). La memoria y el espacio en disco que usa todavía no se midieron; el techo de memoria es de 256 MB.",
  installService: "Instalar el servicio de llamadas por WhatsApp",
  servicePreparing: "Preparando el servicio: el servidor está descargando las llamadas por WhatsApp. Tarda unos minutos, y esta pantalla lo acompaña.",
  serviceFailed: {
    no_disk: "El servidor no tiene espacio en disco para el servicio de llamadas por WhatsApp. No se descargó nada.",
    pull_failed: "El servidor no logró descargar el servicio de llamadas por WhatsApp. Suele ser la internet del servidor, el registro de imágenes caído o falta de espacio en disco.",
    start_failed: "El servidor descargó el servicio de llamadas por WhatsApp, pero no arrancó. Suele ser falta de memoria o de espacio en disco.",
    remove_failed: "El servidor no logró quitar el servicio de llamadas por WhatsApp.",
    unknown: "El servidor no logró instalar el servicio de llamadas por WhatsApp.",
  },
  noDisk: "El servidor no tiene espacio en disco para el servicio de llamadas por WhatsApp: hay {free} GB libres y pide {needed} GB. Faltan cerca de {missing} GB. No se descargó nada. Libera espacio (copias antiguas en backups/, por ejemplo) o amplía el disco.",
  lowMemory: "Cuando se instaló el servicio, el servidor tenía menos memoria disponible que su techo (256 MB). Está en marcha, pero puede faltar memoria para el resto de DeskVoice. Vigila el servidor, o quita el servicio.",
  imageKept: "El servicio se quitó y la memoria se liberó, pero sus archivos no salieron del disco, porque otra cosa en este servidor los usa. El servidor lo intenta de nuevo solo cada minuto. Para intentarlo ahora, ejecuta en el servidor:",
  serviceRetry: "El servidor lo intenta de nuevo solo en unos 10 minutos. El registro de lo que pasó queda en el servidor, en deploy/agent/agent.log.",
  serviceRemoving: "Quitando el servicio de llamadas por WhatsApp del servidor. Tarda hasta un minuto.",
  removeService: "Quitar el servicio de llamadas por WhatsApp",
  removeServiceConfirm:
    "¿Quitar el servicio de llamadas por WhatsApp de este servidor? Ningún número queda conectado para llamadas, y su memoria y disco se liberan. Si alguna vez se conectó un número aquí, revisa en su teléfono, en Dispositivos vinculados, que este dispositivo salió, y quítalo si sigue allí. Para volver, basta instalarlo de nuevo.",
  removeServiceConfirmPhone:
    "¿Quitar el servicio de llamadas por WhatsApp de este servidor? El número {phone} fue el último conectado aquí: revisa en su teléfono, en Dispositivos vinculados, que este dispositivo salió, y quítalo si sigue allí. La memoria y el disco del servicio se liberan. Para volver, basta instalarlo de nuevo.",
  removeServiceYes: "Quitar el servicio de llamadas por WhatsApp",
  agentNever: "El agente de este servidor, que es quien instala y quita el servicio, todavía no habló con el panel. Sin él, el pedido queda esperando. Para ejecutarlo ahora, ejecuta en el servidor:",
  agentSilent: "El agente de este servidor, que es quien instala y quita el servicio, no está respondiendo. El pedido espera hasta que vuelva. Para ejecutarlo ahora, ejecuta en el servidor:",
  riskTitle: "Antes de conectar",
  risk: "Las llamadas por WhatsApp usan un cliente no oficial (WaCalls), que conecta el número como un dispositivo más, y no la API oficial de Meta. WhatsApp puede restringir o bloquear el número, sin aviso. Usa un número dedicado a la atención, nunca el tuyo personal.",
  devices:
    "WhatsApp acepta hasta cuatro dispositivos vinculados a un número, y las llamadas suenan en todos. Este servicio ocupa uno de esos lugares. Con más de cuatro dispositivos (cuentas con Meta Verified, por ejemplo), las llamadas suenan solo en el teléfono, y este servicio deja de recibirlas.",
  messagesNumber:
    "El número {phone} está conectado para mensajes, en WhatsApp. Si conectas el mismo número aquí, habrá dos dispositivos vinculados al mismo WhatsApp: si el número es bloqueado, los mensajes y las llamadas se detienen juntos.",
  sameNumber:
    "Este número también está conectado para mensajes. Son dos dispositivos vinculados al mismo WhatsApp. Si el número es bloqueado, los mensajes y las llamadas se detienen juntos. WhatsApp acepta hasta cuatro dispositivos vinculados; con más que eso, las llamadas suenan solo en el teléfono.",
  connect: "Conectar",
  starting: "Preparando la conexión. El código QR aparece en unos segundos.",
  qrTitle: "Lee el código con el teléfono del número",
  steps: [
    "Abre WhatsApp en el teléfono del número que va a recibir las llamadas.",
    "Toca Más opciones (o Configuración) y luego Dispositivos vinculados.",
    "Toca Vincular un dispositivo y apunta la cámara a este código.",
  ],
  qrAlt: "Código QR para conectar el número a las llamadas por WhatsApp",
  qrRenew: "El código se cambia solo algunas veces y vale por pocos minutos. Esta pantalla lo acompaña y avisa cuando se conecte.",
  qrBetween: "Generando el próximo código.",
  connected: "Conectado",
  connectedNumber: "Número conectado: {phone}",
  connectedUnknown: "Hay un número conectado.",
  since: "Conectado desde {when}.",
  disconnect: "Desconectar",
  disconnectConfirm: "¿Desconectar {phone} de las llamadas por WhatsApp? El dispositivo sale de Dispositivos vinculados en el teléfono, y para volver habrá que leer el código QR otra vez.",
  disconnectYes: "Desconectar {phone}",
  thisNumber: "el número conectado",
  failed: {
    logged_out:
      "El número se desconectó: el dispositivo fue quitado en Dispositivos vinculados, en el teléfono, o WhatsApp cerró la conexión. WhatsApp desconecta los dispositivos vinculados cuando el teléfono principal pasa más de 14 días sin uso.",
    qr_expired: "El código QR no se leyó a tiempo, y el intento se cerró.",
    missing:
      "El servicio de llamadas por WhatsApp ya no tiene los datos de esta conexión. Esto ocurre después de restaurar una copia, de cambiar de servidor o de reinstalar el servicio, porque el emparejamiento no entra en la copia.",
  },
  reconnect: "Conectar de nuevo",
  newCode: "Generar un código nuevo",
};

export default whatsappCalls;
