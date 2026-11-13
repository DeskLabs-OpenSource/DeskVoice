import type { FollowUpsDictionary } from "../pt-BR/follow-ups";

const followUps: FollowUpsDictionary = {
  title: "Pendientes",
  lead: "Lo que se acordó en las llamadas y necesita a una persona: devolver la llamada, enviar, revisar. Cada uno tiene un responsable, un plazo y un cierre que queda en la línea de tiempo de la llamada.",
  views: { mine: "Míos", open: "Abiertos", overdue: "Vencidos", closed: "Cerrados" },
  empty: {
    mine: "Ningún pendiente abierto contigo.",
    open: "Ningún pendiente abierto.",
    overdue: "Ningún pendiente vencido.",
    closed: "Ningún pendiente cerrado todavía.",
  },
  emptyBody: "Cuando un agente con la herramienta create_task acuerde una devolución en la llamada, el pendiente aparece aquí.",
  team: "El equipo",
  owner: "Responsable",
  due: "Plazo",
  overdue: "Vencido",
  olderThanRetention: "Abierto hace más tiempo que el plazo de conservación ({days} días). Un pendiente abierto no se borra por el plazo: ciérralo o cancélalo cuando esté resuelto.",
  caller: "Teléfono",
  openCall: "Ver la llamada",
  status: { open: "Abierto", done: "Hecho", canceled: "Cancelado" },
  closedBy: "{status} por {name} el {when}",
  removedPerson: "una persona que dejó el equipo",
  done: "Marcar como hecho",
  cancel: "Cancelar pendiente",
  noteDone: "Qué se hizo",
  noteDoneHint: "Una frase. Ejemplo: Devolví la llamada, cita agendada para el 14/11.",
  noteCancel: "Por qué se canceló",
  noteCancelHint: "Una frase. Queda con el pendiente y aparece para quien abra la llamada.",
  confirmDone: "Cerrar como hecho",
  confirmCancel: "Cancelar el pendiente",
  keepOpen: "Volver",
  changeOwner: "Cambiar el responsable",
  notYours: "Este pendiente es de otra persona. Solo ella, un dueño o un administrador puede cambiarlo.",
};

export default followUps;
