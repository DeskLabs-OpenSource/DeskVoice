// O link para quem ligou baixar a gravação da própria chamada: a seção da tela da chamada, para quem
// cria, e a página pública, para quem recebe.
const share = {
  title: "Link para quem ligou",
  lead: "Quando quem ligou pede a gravação desta chamada, crie um link e mande para a pessoa. Ele vale {hours} horas e permite {uses} downloads do áudio. Abrir a página do link não gasta download.",
  warning: "Qualquer pessoa que tiver o link baixa o áudio, que tem também a voz do agente. Mande só para quem pediu.",
  addressHint: "O link usa o endereço público desta instalação. Sem um domínio configurado, ele só abre de dentro do servidor.",
  create: "Criar link",
  createdTitle: "Link criado",
  createdBody: "Copie agora: o endereço aparece só esta vez. Vale até {until}, com {uses} downloads.",
  linkLabel: "Endereço do link",
  copy: "Copiar",
  copied: "Copiado.",
  done: "Pronto",
  liveTitle: "Links que ainda valem",
  liveEmpty: "Nenhum link valendo para esta chamada.",
  liveRow: "Criado em {created} por {who}. Vale até {until}. Downloads: {uses} de {max}.",
  removedPerson: "uma pessoa que saiu da equipe",
  revoke: "Revogar os links",
  revokeConfirmOne: "Revogar o link que ainda vale para esta chamada? Quem tiver o endereço deixa de baixar o áudio na hora.",
  revokeConfirmMany: "Revogar os {count} links que ainda valem para esta chamada? Quem tiver o endereço deixa de baixar o áudio na hora.",
  revokeYes: "Revogar",
  revoked: "Links revogados.",
  page: {
    title: "Gravação da sua ligação",
    lead: "Este é o áudio da ligação de que você pediu a gravação.",
    started: "Início",
    ended: "Fim",
    endedUnknown: "Sem registro",
    validUntil: "Vale até",
    left: "Downloads que restam",
    download: "Baixar a gravação",
    downloadHint: "Cada download gasta um dos que restam. O arquivo é um áudio WAV, que abre no celular e no computador.",
    personal: "Este link é pessoal: quem tiver o endereço consegue baixar o áudio. Não o repasse.",
    goneTitle: "Este link não vale mais.",
    goneBody: "Ele pode ter vencido, ter chegado ao limite de downloads ou ter sido revogado. Peça um novo a quem enviou.",
  },
};

export default share;
export type ShareDictionary = typeof share;
