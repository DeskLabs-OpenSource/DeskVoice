const voice = {
  /** O item no menu de Configurações. */
  menu: "Voz",
  title: "Voz",
  lead: "A voz do agente no motor em pipeline, separada do cérebro e da transcrição. Aqui ficam a chave e as vozes que a conta já tem. Escolher a voz no agente chega numa versão posterior: por enquanto, o agente não fala por esta voz.",
  guide: "Como funciona, o que sai do servidor e como apagar: docs/guides/voz.md",
  /** `{voice}` é o nome do fornecedor. */
  keyOf: "Chave de {voice}",
  keyLink: "Onde pegar a chave",
  keySaved: "Chave salva",
  keyMissing: "Sem chave",
  keyNew: "Cole a chave nova para trocar",
  keySave: "Salvar e testar",
  retest: "Testar de novo",
  /** A confirmação nomeando o fornecedor (desenho R5, seção 9.1). `{provider}` é o nome dele. */
  confirm: "O texto que o agente fala na ligação vai para a {provider}. Ele pode repetir o que a pessoa disse, como nome, endereço e telefone.",
  confirmRequired: "Marque a confirmação para salvar a chave.",
  /** `{who}` é o nome de quem confirmou; `{when}`, a data e a hora no idioma da tela. */
  confirmedBy: "Envio confirmado por {who} em {when}.",
  removedPerson: "uma pessoa que saiu da equipe",
  remove: "Remover",
  removeConfirm: "Remover a chave de {provider}? A confirmação do envio também sai, e uma chave nova pede confirmação de novo. O registro de quem confirmou fica na seção Privacidade.",
  removeYes: "Remover a chave de {provider}",
  cancel: "Cancelar",
  neverTested: "A chave ainda não foi testada. Use Testar de novo.",
  savedNotTested: "Chave salva. O teste ficou para daqui a alguns minutos: o limite de testes foi atingido.",
  /** `{when}` é a data do teste; `{result}`, uma frase de `results`. */
  tested: "Testada em {when}: {result}",
  /** `{status}` é o código HTTP que o fornecedor devolveu. */
  status: "({status})",
  results: {
    accepted: "aceita.",
    rejected: "o fornecedor recusou a chave. Confira se ela foi copiada inteira e se não foi revogada.",
    model_unavailable: "a chave vale, mas a conta não tem acesso ao modelo.",
    no_credit: "a chave vale, mas a conta está sem crédito.",
    region_unavailable: "o fornecedor não atende o país ou a região deste servidor.",
    rate_limited: "o fornecedor pediu para esperar. Tente de novo em alguns minutos.",
    unreachable: "o fornecedor não foi alcançado. Confira se o servidor alcança a internet.",
    provider_error: "o fornecedor respondeu com erro do lado dele. Costuma passar sozinho: tente de novo em alguns minutos.",
    unexpected_response: "o fornecedor respondeu fora do esperado. Tente de novo mais tarde.",
    not_needed: "esta voz não pede chave.",
  },
  errors: {
    provider_confirmation_required: "Marque a confirmação para salvar a chave.",
    provider_confirmation_invalid: "A confirmação não nomeia o fornecedor desta voz.",
    synthesizer_key_missing: "Esta voz não tem chave salva. Cole a chave e salve antes.",
    too_many_voice_reads: "Muitas leituras da lista de vozes em pouco tempo. Espere alguns minutos e tente de novo.",
  },
  voicesTitle: "Vozes da conta",
  voicesShow: "Ver as vozes",
  voicesHide: "Esconder as vozes",
  /** `{count}` é o número de vozes. */
  voicesCount: "{count} vozes. As de português do Brasil vêm primeiro.",
  voicesNone: "A conta não tem nenhuma voz.",
  /** `{result}` é uma frase de `results`. */
  voicesFailed: "Não foi possível ler as vozes: {result}",
  voicesLanguagesNone: "Idioma não declarado",
  /** A amostra é hospedada pelo fornecedor: tocar não gasta crédito. */
  sampleHint: "A amostra vem da própria {provider} e não gasta crédito.",
  /** `{voice}` é o nome da voz. */
  sampleOf: "Amostra de {voice}",
  noSample: "Sem amostra",
  /** O aviso de para onde vai o texto. Só diz o que as páginas do fornecedor dizem. */
  noticeTitle: "Para onde vai o texto",
  goes: "O texto que o agente fala na ligação vai para a {provider}.",
  location: {
    "this-server": "Esta voz roda neste servidor: o texto não sai daqui.",
    undeclared: "A {provider} não declara onde processa o texto.",
    /** `{country}` vem de `countries`. */
    country: "O serviço da {provider} é hospedado {country}.",
  },
  countries: { US: "nos Estados Unidos" } as Record<string, string>,
  /** O nome do fornecedor como a tela o escreve, pelo `provider` da voz. */
  providers: { elevenlabs: "ElevenLabs" } as Record<string, string>,
  /**
   * A retenção, pelo `provider` da voz. Só o que as páginas dizem, lidas em 17/11/2026 (DESA-101):
   * https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode. Mudar uma frase aqui pede
   * ler a página de novo e atualizar docs/guides/voz.md.
   */
  retention: {
    elevenlabs: [
      "Por padrão, a ElevenLabs guarda no histórico da conta o texto enviado e o áudio gerado, até alguém apagar a geração ou a conta. A página não dá outro prazo.",
      "Depois de apagados, eles ficam até 30 dias em cópia de segurança.",
      "Os registros de depuração e moderação dela podem guardar dados da geração, sem prazo declarado.",
      "O modo sem retenção é só do plano Enterprise da ElevenLabs.",
    ],
  } as Record<string, string[]>,
  /**
   * Onde o fornecedor guarda, quando a página dele diz, com o país em `countries`. É armazenamento, e
   * não o lugar de processamento: https://elevenlabs.io/privacy-policy ("Updated 9 October 2026"),
   * "transferred to the United States for storage".
   */
  storage: "A {provider} guarda os dados pessoais {country}.",
  retentionUnread: "A política de retenção deste fornecedor não foi lida pelo projeto.",
  /** `{read}` é o dia em que o projeto leu a página. */
  retentionSource: "Fonte da retenção: documentação do fornecedor, lida em {read}.",
  /** `{updated}` é a data que a página traz; `{read}`, o dia da leitura. */
  storageSource: "Fonte do armazenamento: política de privacidade do fornecedor (atualizada em {updated}), lida em {read}.",
  /** `{read}` é o dia em que o projeto leu a página do lugar do processamento. */
  locationSource: "Fonte do lugar: página do fornecedor, lida em {read}.",
};

export default voice;
export type VoiceDictionary = typeof voice;
