const brains = {
  /** O item no menu de Configurações. */
  menu: "Cérebros",
  title: "Cérebros",
  lead: "O cérebro é o modelo de texto que lê a ligação depois que ela termina. Cada provedor pede uma chave própria, separada da chave do motor de voz. A lista de modelos vem do provedor, com a chave da sua conta, e é relida a cada 24 horas.",
  /** `{brain}` é o nome do provedor. */
  keyOf: "Chave de {brain}",
  keyLink: "Onde pegar a chave",
  keySaved: "Chave salva",
  keyMissing: "Sem chave",
  keyNew: "Cole a chave nova para trocar",
  keySave: "Salvar e testar",
  refresh: "Atualizar lista",
  remove: "Remover",
  removeConfirm: "Remover a chave de {brain}? A lista de modelos de {brain} também é apagada. A chave removida não pode ser recuperada.",
  removeYes: "Remover a chave de {brain}",
  cancel: "Cancelar",
  neverTested: "A chave ainda não foi testada. Use Atualizar lista para testar.",
  /** `{when}` é a data do teste, formatada no idioma da tela; `{result}`, uma frase de `results`. */
  tested: "Testada em {when}: {result}",
  savedNotTested: "Chave salva. O teste ficou para daqui a alguns minutos: o limite de leituras deste provedor foi atingido.",
  /** `{status}` é o código HTTP que o provedor devolveu. */
  status: "({status})",
  results: {
    accepted: "aceita.",
    rejected: "o provedor recusou a chave. Confira se ela foi copiada inteira e se não foi revogada, ou gere uma nova no site do provedor.",
    no_credit: "a chave vale, mas a conta está sem crédito ou atingiu o teto de gasto. Adicione crédito ou aumente o teto no site do provedor.",
    region_unavailable: "o provedor não atende o país ou a região deste servidor. Trocar a chave não resolve.",
    rate_limited: "o provedor pediu para esperar (limite de pedidos da conta). Tente de novo em alguns minutos.",
    unreachable: "o provedor não respondeu a tempo, ou está fora do ar. Confira se o servidor tem acesso à internet e tente de novo.",
    unexpected_response: "o provedor respondeu algo que o DeskVoice não reconhece. Tente de novo; se continuar, abra uma issue no repositório.",
  },
  errors: {
    too_many_brain_checks: "Muitas leituras da lista deste provedor em pouco tempo. Espere alguns minutos e tente de novo.",
    brain_key_missing: "Este provedor não tem chave salva. Cole a chave e salve antes.",
  },
  modelsTitle: "Modelos que a chave alcança",
  /** `{count}` é o número de modelos; `{when}`, a data da leitura. */
  modelsCount: "{count} modelos, lidos em {when}.",
  modelsNone: "Nenhum modelo de texto na lista desta chave.",
  modelsNotRead: "A lista ainda não foi lida.",
  modelsStale: "Não foi possível reler a lista agora. Esta é a última lida, e pode estar desatualizada.",
  modelsShow: "Ver os modelos",
  modelsHide: "Esconder os modelos",
  search: "Buscar modelo",
  searchEmpty: "Nenhum modelo com esse nome.",
  /** `{input}` e `{output}` são preços em dólar por milhão de tokens. */
  price: "Entrada {input} · saída {output} por milhão de tokens",
  /** `{date}` é o dia em que o preço foi conferido. */
  priceSource: "fonte, {date}",
  noPrice: "Sem preço conhecido",
  noPriceHint: "O custo deste modelo não pode ser medido.",
  /** `{tokens}` é o tamanho do contexto. */
  context: "contexto de {tokens} tokens",
};

export default brains;
export type BrainsDictionary = typeof brains;
