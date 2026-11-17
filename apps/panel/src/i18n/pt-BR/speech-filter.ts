const speechFilter = {
  /** O item no menu de Configurações. */
  menu: "Filtro de fala",
  title: "Filtro de fala",
  lead: "Um modelo de decisão lê o texto do que a pessoa fala na ligação e marca o que pode ser fala de fundo, ou sugere a leitura provável de um termo do vocabulário do agente. Ele só marca e sugere: nunca apaga nem troca o que a pessoa disse. Vem desligado.",
  guide: "Como funciona, o que sai do servidor e como pedir a exclusão: docs/guides/filtro-de-fala.md",
  model: "Modelo de decisão",
  none: "Nenhum (desligado)",
  /** `{who}` é o nome de quem confirmou; `{when}`, a data e a hora no idioma da tela. */
  confirmedBy: "Envio confirmado por {who} em {when}.",
  /** A confirmação nomeando o fornecedor (desenho R12, "Custo e consentimento"). `{provider}` é o nome dele. */
  confirm: "O texto do que a pessoa fala na ligação vai para a {provider}.",
  confirmRequired: "Marque a confirmação para ligar este modelo.",
  save: "Salvar",
  saved: "Salvo.",
  keyNeeded: "Salve e teste a chave deste modelo antes de ligá-lo.",
  keysTitle: "Chaves dos modelos",
  /** `{model}` é o nome do modelo. */
  keyOf: "Chave de {model}",
  keySaved: "Chave salva",
  keyMissing: "Sem chave",
  keyNew: "Cole a chave nova para trocar",
  keySave: "Salvar e testar",
  remove: "Remover a chave",
  removeInUse: "Desligue o filtro antes de remover a chave do modelo em uso.",
  neverTested: "A chave ainda não foi testada.",
  savedNotTested: "Chave salva. O teste ficou para daqui a alguns minutos: o limite de testes foi atingido.",
  /** `{when}` é a data do teste; `{result}`, uma frase de `results`. */
  tested: "Testada em {when}: {result}",
  results: {
    accepted: "aceita.",
    rejected: "o fornecedor recusou a chave. Confira se ela foi copiada inteira e se não foi revogada.",
    model_unavailable: "a chave vale, mas a conta não tem acesso ao modelo.",
    no_credit: "a chave vale, mas a conta está sem crédito.",
    region_unavailable: "o fornecedor não atende o país ou a região deste servidor.",
    rate_limited: "o fornecedor pediu para esperar. Tente de novo em alguns minutos.",
    unreachable: "o fornecedor não foi alcançado. Confira se o servidor alcança a internet.",
    unexpected_response: "o fornecedor respondeu fora do esperado. Tente de novo mais tarde.",
    not_needed: "este modelo não pede chave.",
  },
  /** O aviso de onde o texto vai. Só diz o que a fonte do fornecedor diz. */
  noticeTitle: "Para onde vai o texto",
  location: {
    "this-server": "Este modelo roda neste servidor: o texto não sai daqui.",
    undeclared: "A {provider} não declara onde processa o texto.",
    /** `{country}` vem de `countries`. */
    country: "O serviço da {provider} é hospedado {country}.",
  },
  countries: { US: "nos Estados Unidos" } as Record<string, string>,
  /** O nome do fornecedor como a tela o escreve, pelo `provider` do modelo. */
  providers: { typesafe: "TypeSafe" } as Record<string, string>,
  /**
   * A retenção, pelo `provider` do modelo, com a página e a data da leitura. Só o que a página diz:
   * https://typesafe.ai/legal/privacy-policy, seção *Retention* ("Last updated Nov 19, 2025", lida em
   * 16/11/2026). Mudar uma frase aqui pede ler a página de novo.
   */
  retention: {
    typesafe: [
      "A TypeSafe guarda os dados pessoais que recebe, como esse texto, pelo tempo que for razoavelmente necessário para prestar o serviço ou para os fins comerciais dela, sem prazo definido na política.",
      "A pedido, ela apaga esses dados ou os guarda de um jeito que não identifique a pessoa.",
    ],
  } as Record<string, string[]>,
  retentionUnread: "A política de retenção deste fornecedor não foi lida pelo projeto.",
  /** `{updated}` é a data que a página traz; `{read}`, o dia em que o projeto a leu. */
  source: "Fonte: política de privacidade do fornecedor (atualizada em {updated}), lida em {read}.",
  /** A fonte do lugar, quando ela não é a mesma página da retenção. */
  locationSource: "Fonte do lugar: página do fornecedor, lida em {read}.",
};

export default speechFilter;
export type SpeechFilterDictionary = typeof speechFilter;
