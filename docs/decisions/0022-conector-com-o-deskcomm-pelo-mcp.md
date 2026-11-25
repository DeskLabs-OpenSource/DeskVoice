# 0022: O conector com o DeskcommCRM fala pelo MCP do CRM

- **Estado:** proposta. Fica aceita com a palavra do dono do projeto, registrada no PR.
- **Data:** 2026-11-24
- **Quem decidiu:** o desenho foi proposto na issue
  [#330](https://github.com/DeskLabs-OpenSource/DeskVoice/issues/330), e a resposta de desenho de
  24/11/2026 escolheu a porta. A aceitação é do dono do projeto.
- **Atualiza:** [`0001`](0001-fronteira-com-o-deskcomm.md)

## Contexto

A 0001 separou os dois projetos: o DeskVoice é independente, nenhum depende do outro, e o conector
com o DeskcommCRM ficou como trabalho futuro, sem data.

As ferramentas de agenda (`agenda_horarios_livres`, `agenda_marcar`, `agenda_remarcar`) já existem.
Elas falam com a interface `AgendaClient` (`packages/tools/src/connectors/agenda.ts`) e ficam
escondidas enquanto ninguém injeta um cliente. O caso de quem pede o conector: uma empresa que
atende por telefone e marca visita. Quem liga quer marcar, e sem agenda a ligação termina em recado.

Havia três portas possíveis do lado do CRM:

- as rotas REST de agenda, que o CRM mantém só para sessão de navegador, de propósito
  (`app/api/v1/agenda/agendamentos/route.ts`, com a suíte da rota travando esse estado);
- o servidor MCP do CRM (`/api/mcp`, token `dsk_`), que já tem as ferramentas de agenda e de
  contatos;
- não fazer.

## Decisão

1. **O DeskVoice fala com o CRM pelo MCP do CRM.** A agenda passa por `crm_list_event_types`,
   `crm_find_free_slots`, `crm_book_appointment` e `crm_reschedule_appointment`, e o contato por
   `crm_search_contacts`. O cliente usa o cliente MCP que já existe em
   `packages/tools/src/mcp/client.ts`, e nenhum segundo cliente JSON-RPC é escrito. Duas coisas
   vão pela REST do CRM, com o mesmo token: a fatia 1a cria o contato de um número novo por
   `POST /api/v1/conversations/open-with-contact`, e a fatia 2 manda a mensagem por
   `POST /api/v1/messages`. Por isso o token não pode ser só-MCP: um token `aud:mcp` é recusado
   fora do `/api/mcp`.
2. **O conector é opcional.** Sem endereço do CRM e token configurados, nada muda: as ferramentas de
   agenda continuam escondidas, e o conector `deskcomm` de mensagem segue como hoje.
3. **O DeskVoice funciona sem o CRM.** Nenhuma parte da ligação, da instalação ou do painel passa a
   exigir o CRM. Com o CRM fora do ar, a ligação continua: quem ligou ouve uma fala, o painel recebe
   uma pendência e a linha do tempo recebe um evento.
4. **As regras da agenda moram no CRM.** O DeskVoice não as reimplementa: horário publicado, fuso,
   agenda externa, confirmação pela equipe e idempotência da marcação são decididos lá e chegam como
   dado na resposta.
5. **O texto que vem do CRM é dado, e não vai para o modelo.** Toda resposta é validada com Zod. O
   cliente traduz o `motivo` de uma recusa para as falas do DeskVoice, e o campo `mensagem`, escrito
   para o modelo do CRM, não chega ao modelo do DeskVoice. Motivo desconhecido vira erro genérico.
6. **O cliente é da organização, e não do processo.** O endereço e o token são de cada organização.
   O cliente é resolvido pela organização da ligação, e o de uma organização nunca atende a ligação
   de outra.

A interface `AgendaClient` continua genérica. O cliente do DeskcommCRM é uma implementação dela, e
outra agenda pode entrar pelo mesmo lugar.

O conector no outro sentido, o módulo de ligações do CRM virando conector fino para o DeskVoice,
continua como a 0001 descreve.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| As rotas REST de agenda do CRM | O CRM decidiu manter a leitura da agenda só por sessão. Usar a REST pediria ao CRM uma decisão de produto no sentido contrário, e ela não entrega as regras que o MCP entrega (`publicou_horarios`, `fuso_suposto`, `agenda_externa_nunca_lida`, `ha_mais`, `aguarda_confirmacao`) |
| Um cliente JSON-RPC próprio do conector | O DeskVoice já tem um cliente MCP mínimo, com prazo, teto de tamanho e `safeFetch`. Um segundo cliente duplicaria essas guardas |
| Não fazer | As ferramentas de agenda seguem escondidas, e a ligação de quem quer marcar termina em recado |
| Reimplementar no DeskVoice as regras da agenda | Duas cópias da mesma regra divergem. Quem decide se um horário está livre é a agenda que guarda o horário |

## Consequências

**Boas:**

- Quem usa os dois projetos marca a visita durante a ligação, e o compromisso aparece na ficha de
  quem ligou no CRM.
- A 0001 continua de pé: o conector é opcional, e cada projeto funciona sozinho.
- As regras da agenda ficam num lugar só.

**Custos:**

- **O DeskVoice passa a depender do formato das respostas do MCP do CRM.** Uma mudança lá quebra o
  mapeamento aqui. A validação com Zod transforma essa quebra em erro com fala, e não em horário
  marcado por engano.
- **Uma credencial nova cifrada por organização** (o token `dsk_`), gravada pela tela do conector.
  As fatias que tocam a tela, a sessão da ligação ou a credencial guardada são caminho sensível e
  passam pelo dono do projeto.
- **O CRM precisa ser alcançado por endereço público.** O `safeFetch` recusa destino privado, e esta
  decisão não o afrouxa. Um CRM no mesmo servidor, por endereço privado, volta a ser pergunta.
- **O que falta no CRM fica com o CRM:** nota de conversa por token (resumo da ligação), origem do
  contato por token, criação de contato sem afirmar WhatsApp, e a chave de idempotência também na
  remarcação. O DeskVoice não contorna nenhuma dessas faltas.

**Fatias:** a ordem e o que cada uma entrega estão na issue
[#330](https://github.com/DeskLabs-OpenSource/DeskVoice/issues/330). Este registro só fixa a porta e
a fronteira.
