const privacy = {
  recordingTitle: "Gravação das chamadas",
  recordingLead:
    "Grava o áudio de cada ligação desta organização num arquivo, que se ouve na tela da chamada: quem ligou num canal, o agente no outro. Vem desligada. Vale a partir da próxima chamada.",
  recordingSwitch: "Gravar o áudio das chamadas",
  recordingDisk:
    "Cada minuto de chamada ocupa cerca de 1,9 MB no disco do servidor. É a conta do formato (dois canais, 8 kHz, 16 bits), e não uma medição.",
  recordingKeeps:
    "Ligar ou desligar não apaga nada. As gravações já feitas seguem o prazo de guarda abaixo: saem junto com o texto da conversa, e sem prazo ficam para sempre. Os backups de hoje não incluem as gravações. Confira se o aviso do começo da ligação diz a quem liga que a conversa fica registrada.",
  recordingForever:
    "O prazo de guarda está vazio: as gravações ficam para sempre, e o disco do servidor cresce sem limite, cerca de 1,9 MB por minuto de chamada. Defina um prazo abaixo para que as gravações antigas saiam.",
  recordingStates: { on: "ligada", off: "desligada" },
  retentionTitle: "Prazo de guarda das conversas",
  retentionLead:
    "A transcrição de cada ligação, o que quem ligou e o agente disseram, fica no banco até sair do prazo. Depois dele, o texto é trocado por um marcador e a gravação, quando houver, é apagada; a chamada, o horário, o resumo e o resto da linha do tempo continuam. As pendências fechadas há mais tempo que o prazo, contado do fecho, também saem; a pendência aberta fica até alguém fechar.",
  retentionDays: "Guardar por (dias)",
  retentionHint: "Vazio guarda para sempre. O menor prazo é de {min} dias.",
  currentForever: "Hoje esta organização guarda a transcrição para sempre.",
  currentDays: "Hoje esta organização guarda a transcrição por {days} dias.",
  irreversible:
    "O texto que sai não volta, nem por este painel nem pelo servidor. Os backups já feitos continuam com o texto até serem descartados. O resumo da chamada e os dados que as ferramentas enviaram não saem com o prazo.",
  save: "Salvar prazo",
  confirmTitle: "Apagar o texto das conversas com mais de {days} dias?",
  confirmBody:
    "O texto dessas conversas sai do banco em instantes, e daí em diante uma vez por dia; a gravação delas, quando houver, sai junto. O que sai não volta. Os backups já feitos continuam com o texto até serem descartados.",
  confirmYes: "Apagar e guardar por {days} dias",
  exportTitle: "Dados de uma pessoa que ligou",
  exportLead:
    "Quando alguém pede o que a central guarda sobre ela, informe o telefone. Sai um arquivo com as chamadas desse número nesta organização, os eventos delas, as pendências abertas para ele e a entrada na lista de não ligar. A fala que já saiu pelo prazo aparece como apagada. Cada chamada diz se tem gravação; o áudio não vai no arquivo e se ouve na tela da chamada.",
  exportPhone: "Telefone",
  exportPhoneHint: "A busca é pelo número. Se a pessoa ligou de outro telefone, exporte cada um.",
  exportRun: "Exportar",
  exportDone: "Arquivo de {phone} baixado. Chamadas: {calls}. Eventos: {events}.",
  exportDoneFollowUps: "Pendências: {count}.",
  exportDoneDnc: "O número está na lista de não ligar, e isso também está no arquivo.",
  exportEmpty: "Esta organização não tem registro de {phone}. Nenhum arquivo foi baixado, e a consulta ficou no registro abaixo.",
  exportCare: "O arquivo tem dados pessoais. Entregue pelo canal combinado com a pessoa e apague a cópia deste computador depois.",
  fileName: "dados-{phone}-{date}.ndjson",
  historyTitle: "Registro",
  historyLead: "Quem mudou o prazo ou a gravação, o que saiu pelo prazo e quem exportou os dados de qual telefone. Os 50 mais recentes.",
  historyEmpty: "Nada registrado ainda.",
  history: {
    transcript_retention_changed: "{who} mudou o prazo de guarda de {from} para {to}.",
    transcripts_purged: "O texto das falas com mais de {days} dias foi apagado pelo prazo. Falas apagadas: {count}.",
    caller_data_exported: "{who} exportou os dados de {phone}. Chamadas: {calls}. Eventos: {events}.",
    call_recording_changed: "{who} deixou a gravação das chamadas {state}.",
  },
  purgedRecordings: "Gravações apagadas: {count}.",
  purgedFollowUps: "Pendências fechadas apagadas: {count}.",
  forever: "para sempre",
  days: "{n} dias",
  removedPerson: "Uma pessoa que saiu da equipe",
};

export default privacy;
export type PrivacyDictionary = typeof privacy;
