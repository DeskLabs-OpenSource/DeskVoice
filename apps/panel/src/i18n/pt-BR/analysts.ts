const analysts = {
  /** O item no menu de Configurações. */
  menu: "Analistas",
  title: "Analistas ao vivo",
  lead: "Um analista lê a conversa enquanto ela acontece, dá a temperatura e reconhece as objeções que você cadastrar. Quando reconhece uma, o agente recebe a orientação que você escreveu para ela, sem que quem ligou perceba. Vem sem nenhum analista: você o liga em cada agente, no campo Analista.",
  /** O limite da seção 3.5 do desenho, dito na tela. */
  timelineNote: "A linha do tempo de uma ligação mostra a orientação do cadastro atual. Se você editar a orientação depois, as ligações antigas passam a mostrar o texto novo.",
  /** O corte herdado da R12, sem medida nestas perguntas (desenho R6, seção 6). */
  cutNote: "O analista só orienta com confiança de 80% ou mais. Esse corte veio do filtro de fala: o acerto do modelo nestas perguntas ainda não foi medido.",
  empty: "Nenhum analista cadastrado.",
  add: "Novo analista",
  edit: "Editar",
  cancel: "Cancelar",
  newTitle: "Novo analista",
  /** `{name}` é o nome do analista. */
  editTitle: "Editar {name}",
  name: "Nome",
  nameHint: "Até 40 caracteres. É o nome que aparece no agente e na linha do tempo.",
  model: "Modelo de decisão",
  modelHint: "O modelo que lê a conversa. Ele escolhe e dá nota; não escreve texto.",
  /** Nenhum modelo pronto: falta a chave. */
  noModel: "Nenhum modelo de decisão tem chave salva. Salve a chave em Configurações → Filtro de fala.",
  noModelLink: "Abrir o Filtro de fala",
  /** O modelo gravado não tem chave (ou saiu desta versão). `{model}` é o nome dele. */
  modelNoKey: "{model} não tem chave salva: o analista não lê nada até a chave ser salva em Configurações → Filtro de fala.",
  modelGone: "O modelo {model} não está entre os que esta tela oferece (não está instalado nesta versão, ou é o simulado, que serve a teste): numa ligação real, o analista não lê nada até você escolher outro.",
  keyMissingOption: "sem chave",
  temperature: "Dar a temperatura da conversa",
  temperatureHint: "De 1 (fria: quer encerrar ou não tem interesse) a 5 (quente: quer seguir adiante). Aparece como selo no detalhe da chamada.",
  objections: "Objeções e orientações",
  /** `{max}` é o limite de objeções. */
  objectionsHint: "Até {max}. Para cada objeção, o rótulo que o modelo reconhece e a orientação curta que o agente recebe.",
  objectionLabel: "Rótulo",
  objectionLabelHint: "Até 60 caracteres. Ex.: preço.",
  objectionGuidance: "Orientação ao agente",
  /** `{max}` é o limite de caracteres. */
  objectionGuidanceHint: "Até {max} caracteres. Ex.: Reforce o que está incluso; não ofereça desconto, quem decide desconto é a equipe.",
  /** `{key}` é a chave da objeção, gravada nos eventos. */
  objectionKey: "Identificador: {key}",
  addObjection: "Acrescentar objeção",
  removeObjection: "Tirar esta objeção",
  objectionsNone: "Sem objeções, o analista só dá a temperatura e nunca orienta.",
  /** A confirmação nomeando o fornecedor (desenho R6, seção 2.1). `{provider}` é o nome dele. */
  confirm: "O texto do que a pessoa fala na ligação vai para a {provider}.",
  confirmWhat: "O analista manda ao modelo as seis últimas falas, de quem ligou e do agente, até 1 500 caracteres a cada fala de quem ligou.",
  confirmRequired: "Marque a confirmação para usar este modelo no analista.",
  /** `{who}` é quem confirmou; `{when}`, a data e a hora no idioma da tela. */
  confirmedBy: "Envio confirmado por {who} em {when}.",
  confirmedByGone: "uma pessoa que não está mais na equipe",
  save: "Salvar",
  saved: "Salvo.",
  nameTaken: "Já existe um analista com este nome.",
  /** O resumo de cada analista na lista. */
  temperatureOn: "Temperatura ligada",
  temperatureOff: "Temperatura desligada",
  /** `{n}` é o número de objeções. */
  objectionsCount: "{n} objeções",
  objectionsCountOne: "1 objeção",
  /** `{agents}` são os nomes. */
  usedBy: "Usado por: {agents}",
  usedByNone: "Nenhum agente usa este analista.",
  delete: "Apagar",
  /** A confirmação de apagar: nomeia o analista e os agentes que ficam sem ele. */
  deleteConfirm: "Apagar o analista {name}? O cadastro dele e as orientações escritas vão embora, e não há como desfazer.",
  deleteAgents: "Estes agentes ficam sem analista: {agents}.",
  deleteNoAgents: "Nenhum agente usa este analista.",
  deleteTimeline: "Nas ligações antigas, a linha do tempo deixa de mostrar o rótulo e a orientação das objeções dele.",
  deleteYes: "Apagar {name}",
  /** `{n}` é quantos agentes ficaram sem analista. */
  deleted: "Analista apagado. {n} agentes ficaram sem analista.",
  deletedOne: "Analista apagado. 1 agente ficou sem analista.",
  deletedNone: "Analista apagado.",
};

export default analysts;
export type AnalystsDictionary = typeof analysts;
