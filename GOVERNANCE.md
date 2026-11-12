# Governança do DeskVoice

Este documento diz quem decide o quê, e o que pode ser decidido sem esperar ninguém. Ele existe
porque, no DeskcommCRM, o dono do projeto virou gargalo: decisões pequenas esperavam por ele, e
contribuições boas esfriavam na fila.

A regra geral: **o que cabe numa regra escrita aqui é decidido por quem está na triagem. O que
não cabe vira um pedido de decisão com um padrão que vale se ninguém responder.**

## Quem decide o quê

| Papel | Quem é | Decide |
|---|---|---|
| Dono do projeto | Rafael Melgaço | Visão e posicionamento, licença, parcerias, versão maior, mudança nas regras de produto abaixo, entrada e saída de mantenedores |
| Mantenedores | Pessoas com permissão de escrita, convidadas pelo dono | Merge pela fila, lançamento de versões, resposta a avisos de segurança, pedidos de decisão técnicos |
| Triagem | Mantenedores e os agentes que operam sob este documento | Classificar issue e PR, aplicar as regras de produto, pedir mudanças, recusar o que as regras recusam |
| Contribuidores | Qualquer pessoa | O conteúdo do próprio PR, e propor mudança em qualquer regra daqui |

Agente de IA que participa da triagem opera sob as mesmas regras de uma pessoa, e sob a
[doutrina de operação de agentes](docs/doctrine/operacao-de-agentes.md). Agente não decide
versão maior, licença nem mudança de regra de produto.

## Regras de produto

Com estas regras, a triagem decide sem o dono. Cada uma tem o porquê, para que se aplique ao
caso que ninguém previu.

### 1. O que entra no núcleo e o que é ferramenta

**Entra no núcleo** o que toda instalação precisa para uma ligação virar trabalho: atender,
conversar, executar ferramenta, chamar o humano, transferir, registrar, medir custo, continuar
depois da chamada, instalar e atualizar.

**É ferramenta ou motor**, em arquivo próprio, o que conecta o DeskVoice a um sistema de fora ou
a um provedor: agenda, CRM, pagamento, um modelo de voz novo. Ferramenta de uso geral pode morar
no repositório. Ela não altera o núcleo para existir.

O teste: se a mudança exige editar `apps/voice` ou `packages/core` para atender a um caso de
uso, e não a uma capacidade de telefonia, ela está no lugar errado.

### 2. Código de nicho nunca no núcleo

Regra de clínica, de imobiliária ou de qualquer ramo não entra no núcleo, nem atrás de
configuração. O núcleo não sabe o que é "paciente" ou "imóvel". O que varia por ramo mora nas
instruções do agente e nas ferramentas.

O porquê: cada condição de nicho no núcleo é um caminho que todas as outras instalações carregam
e ninguém testa.

### 3. Nada que facilite disparo em massa

Não entra: importação de lista para discagem, discador automático, remoção ou afrouxamento dos
limites de ligações de saída, forma de contornar a lista de não ligar, rotação de números para
escapar de bloqueio.

O porquê e os limites estão na [doutrina de ligações de saída](docs/doctrine/ligacoes-de-saida.md).
Esta regra não tem exceção por "caso de uso legítimo". Quem precisa disso precisa de outro
software.

### 4. Nada que exija SSH para ligar um recurso

Todo recurso se liga e se configura pela tela. Variável de ambiente nova só com valor padrão ou
gerada pelo instalador. PR que entrega capacidade sem tela fica aberto até a tela chegar, ou
entra junto com ela.

### 5. Sem recurso pago, sem telemetria

Nenhuma capacidade depende de licença, chave do projeto ou serviço do projeto. A instalação não
envia dados de uso a ninguém.

### 6. O caminho genérico nunca é sabotado

A parceria de infraestrutura é uma recomendação. Nada no instalador ou no código funciona melhor
num provedor de VPS do que em outro por escolha do projeto.

### 7. Quem já instalou não é surpreendido

Mudança que exige ação de quem opera uma instalação precisa dizer isso, no campo próprio do
fragmento de versão. A régua está na [doutrina de versionamento](docs/doctrine/versionamento.md).

## Pedido de decisão

Quando nenhuma regra acima resolve, quem está na triagem abre uma issue de decisão. O formato é
obrigatório, porque um pedido sem padrão trava o trabalho de alguém por tempo indeterminado.

```markdown
## Decisão: <a pergunta, em uma frase>

**Quem decide:** dono do projeto | mantenedores
**O que está parado esperando:** <PR, issue ou frente>

### Opções
- **A.** <o que é>. Custo: <o que custa fazer e manter>.
- **B.** <o que é>. Custo: <...>.
- **C.** Não fazer. Custo: <o que se perde>.

### Recomendação
<A, B ou C>, porque <uma razão ligada a quem usa>.

### Se ninguém responder em <N> dias, vale: <opção>

### Não medido
<o que quem escreveu não conferiu, e que poderia mudar a recomendação>
```

Regras do pedido:

- **Toda opção tem custo.** "Não fazer" é sempre uma opção, e também tem custo.
- **O padrão é obrigatório**, com prazo. Vencido o prazo sem resposta, a opção padrão vale e o
  trabalho segue. A decisão pode ser revista depois, por um novo pedido.
- **O padrão deve ser o caminho reversível.** Se nenhuma opção é reversível, o prazo não corre:
  o pedido espera a resposta, e diz isso.
- **"Não medido" não pode ficar vazio por omissão.** Se tudo foi conferido, escreva o que foi
  conferido e como.
- Decisão tomada que muda arquitetura vira um registro em `docs/decisions/`.

## Um único caminho de merge

- Todo código chega à `main` por PR, pela **fila de merge**. Não existe merge direto, para
  ninguém, dono incluído.
- A fila testa cada PR sobre o estado em que ele vai entrar. É isso que impede dois PRs verdes
  de quebrarem a `main` juntos.
- **Check de PR só mede o diff.** O estado acumulado do repositório é check da `main`. Se a
  `main` ficar vermelha, consertá-la é trabalho dos mantenedores e tem prioridade sobre
  qualquer PR.
- Quem escreveu o PR não é quem o aprova. Vale para pessoa e para agente.
- Versão maior só sai por decisão explícita do dono.

### Como está hoje, com um mantenedor só

A regra acima é a meta. Até que haja um segundo mantenedor, ou uma conta de revisão que aprove
pelo GitHub, o caminho real é este:

- **O merge não passa pela fila.** A conta do mantenedor faz o merge por cima da regra do ramo
  (`--admin`), depois que a verificação `ready` do CI fecha verde no head do PR.
- **Quem revisa é uma sessão de agente distinta da que escreveu**, que lê o diff sem o contexto
  de quem o escreveu e dá um veredito. Desde 12/11/2026, esse parecer fica num comentário do
  próprio PR, com o cabeçalho "Parecer de revisão (sessão distinta da que escreveu)", o head
  lido e o veredito. Como a conta é a mesma que abre os PRs, o GitHub não conta o comentário
  como aprovação.
- **Antes de 12/11/2026, a revisão por sessão distinta existiu, mas o rastro ficou fora do PR**,
  na conversa entre as sessões. Os pareceres desse período não foram republicados: comentários
  datados depois do merge não provariam revisão antes dele.
- **Achado de segurança ainda aberto não vai no comentário.** No PR ficam o resumo e o
  veredito; o detalhe segue por canal privado até a correção.
- **Para a regra virar a meta,** falta uma de duas coisas: um segundo mantenedor, ou a conta de
  robô do projeto aprovar pelo GitHub. Com isso, saem o merge por cima da regra e a passagem do
  administrador na regra do ramo. As duas são decisão do dono.

## Avisos de segurança

- Vulnerabilidade se relata em privado, como descrito em [`SECURITY.md`](SECURITY.md).
- Os mantenedores respondem, corrigem em ramo privado e publicam o aviso junto com a versão
  corrigida.
- Correção de segurança é a única mudança que pode entrar sem o prazo normal de revisão
  pública. Ela passa pelos mesmos testes.
- Quem relatou é creditado no aviso, se quiser.

## Conduta

Vale o [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), para todos os papéis.

## Como mudar este documento

Por PR, como qualquer outro arquivo. Mudança nas regras de produto ou nos papéis precisa da
aprovação do dono do projeto. O histórico do arquivo é o registro das mudanças.
