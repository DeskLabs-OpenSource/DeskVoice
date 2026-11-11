# Ganhar dinheiro implementando o DeskVoice

O DeskVoice é gratuito e de código aberto. Isso não impede ninguém de ganhar dinheiro com ele.
O que tem valor para uma empresa não é o software: é o telefone dela sendo atendido direito. Há
trabalho de verdade entre uma coisa e outra, e quem faz esse trabalho pode cobrar por ele.

Este guia é para quem quer instalar, configurar e manter o DeskVoice para clientes.

**Você não deve nada ao projeto por isso.** Não há taxa, licença comercial nem repasse. A
licença MIT permite. Se quiser retribuir, contribua com o que aprender.

## O que você vende

Você não vende um robô. Vende **ligações que deixam de ser perdidas** e **trabalho que deixa de
depender de alguém lembrar**.

Em termos práticos, você entrega:

1. o telefone atendido fora do horário, na hora do almoço e quando todos estão ocupados;
2. o assunto de quem ligou encaminhado: anotado, avisado a quem resolve, com o que foi
   combinado;
3. uma pessoa da equipe chamada quando é preciso, com contexto;
4. um registro de cada ligação, que o dono consegue ler.

## Para quem vender

O bom cliente tem três características: **recebe ligações que valem dinheiro, perde parte
delas e tem um roteiro de atendimento que se repete.**

| Tipo de negócio | Por que faz sentido |
|---|---|
| Clínicas e consultórios | Marcação e remarcação por telefone, recepção ocupada, ligações fora do horário |
| Escritórios (advocacia, contabilidade) | Triagem do primeiro contato, recado certo para a pessoa certa |
| Imobiliárias | Interesse em imóvel fora do horário comercial, qualificação antes do corretor |
| Oficinas e assistências técnicas | Situação de serviço, agendamento, orçamento encaminhado |
| Prestadores de serviço com plantão | Triagem de urgência e acionamento de quem está de plantão |

Para quem **não** vender, pelo menos no começo:

- **Quem quer disparar ligações em volume.** O DeskVoice não faz isso, por desenho. Veja a
  [doutrina de ligações de saída](../doctrine/ligacoes-de-saida.md).
- **Atendimento sem roteiro**, em que cada ligação é um caso novo e complexo.
- **Emergências em que um erro custa caro.** O agente pode fazer a triagem e transferir. Ele não
  substitui o atendimento.
- **Quem quer demitir a equipe.** O sistema foi desenhado com o humano no meio. Vendido como
  substituição, ele decepciona.

## Como descobrir se vale a pena para o cliente

Antes de propor preço, faça três perguntas ao dono do negócio:

1. Quantas ligações vocês recebem por dia, e quantas ficam sem atender?
2. Quanto vale, em média, um cliente que liga?
3. O que a pessoa que atende o telefone faz em nove de cada dez ligações?

A terceira resposta é o roteiro do agente. As duas primeiras são o tamanho do problema. Se o
dono não sabe a primeira, peça o relatório de chamadas à operadora dele: quase sempre existe, e
o número de ligações perdidas costuma surpreender.

## Como precificar

Separe sempre três coisas. Misturar as três é a causa mais comum de prejuízo.

### 1. Implantação (valor único)

É o seu trabalho para colocar no ar. Calcule por horas, com folga:

| Etapa | O que envolve |
|---|---|
| Levantamento | Entender o atendimento atual, ouvir ligações reais ou a descrição de quem atende |
| Infraestrutura | Contratar ou configurar a VPS, instalar, conferir portas e rede |
| Telefonia | Contratar o tronco ou conectar o número, testar entrada e saída de áudio |
| Agente | Escrever as instruções, definir ferramentas, limites e transferência |
| Integração | Ligar o agente aos sistemas do cliente, quando houver |
| Testes | Ligações reais com os casos comuns e com os casos difíceis |
| Entrega | Treinar a equipe para ler a linha do tempo e responder aprovações |

A telefonia e a integração são as etapas que mais estouram a estimativa. Dê folga nas duas.

### 2. Manutenção (valor mensal)

É o que mantém o cliente bem atendido depois da entrega, e é o que sustenta o seu negócio.
Inclui: atualizar a instalação, acompanhar a saúde, conferir o backup, revisar ligações que não
terminaram bem, ajustar as instruções do agente e atender a equipe do cliente.

Defina por escrito o que está incluído: quantas horas de ajuste por mês, em quanto tempo você
responde e em que horário.

### 3. Custos de terceiros (repasse)

VPS, telefonia e IA. Há dois modelos:

| Modelo | Vantagem | Risco |
|---|---|---|
| O cliente contrata no nome dele e paga direto | Você não financia o uso de ninguém, e o cliente é dono das contas | Mais trabalho no começo, para criar as contas com ele |
| Você contrata e repassa | Mais simples para o cliente | O uso de IA varia. Se você cobrar valor fixo, um mês de muito movimento sai do seu bolso |

**Recomendação: as contas no nome do cliente.** Ele é o dono do número, dos dados e das chaves.
Se um dia ele trocar de implementador, nada se perde, e isso é um argumento de venda.

Se for repassar, nunca prometa um valor fixo de IA. Cobre o uso medido, que o painel mostra, e
configure o teto de custo por chamada. Veja o guia de [custos](custos.md).

### Como chegar ao número

Não há tabela de preços neste guia de propósito: ela mudaria de cidade para cidade e
envelheceria em meses. O raciocínio que se sustenta:

- **O piso** é o seu custo: horas vezes o valor da sua hora, mais o que você paga a terceiros.
- **O teto** é o valor do problema: o que o cliente perde hoje com ligações não atendidas, ou o
  que ele paga para alguém atender.
- **O preço fica entre os dois**, mais perto do piso enquanto você não tem casos para mostrar, e
  mais perto do teto quando tem.

## O que entregar

Uma implantação bem feita termina com isto na mão do cliente:

- [ ] O número atendendo, testado com ligações reais.
- [ ] O agente com instruções revisadas pelo dono do negócio.
- [ ] A transferência para uma pessoa funcionando, e testada.
- [ ] Os limites configurados: duração máxima e teto de custo por chamada.
- [ ] Ao menos uma pessoa da equipe treinada para ler a linha do tempo e responder aprovações.
- [ ] Um backup feito e uma cópia guardada fora da VPS.
- [ ] Um documento curto: o que o agente faz, o que não faz, para quem transfere e quem chamar
      se algo parar.
- [ ] As contas (VPS, operadora, IA) no nome do cliente, ou o registro claro de quem é dono de
      cada uma.
- [ ] O limite de gasto definido na conta do provedor de IA.

## O que não prometer

Prometer demais é o caminho mais rápido para perder o cliente e a indicação.

- **Não prometa que o agente nunca erra.** Ele erra. Prometa que o erro aparece na linha do
  tempo e que há uma pessoa para quem transferir.
- **Não prometa substituir a equipe.** Prometa que a equipe para de perder ligação.
- **Não prometa custo fixo de IA.** Prometa teto por chamada e custo visível.
- **Não prometa prazo para recurso do roadmap.** O projeto não tem datas. Venda o que existe
  hoje, listado no [`README.md`](../../README.md).
- **Não prometa conformidade legal.** Você entrega controles. A responsabilidade pelo uso é de
  quem opera, e as regras de gravação, de dados pessoais e de ligações de saída pedem
  orientação de quem conhece o caso. Veja [conformidade no Brasil](conformidade-brasil.md).
- **Não prometa campanha de ligações.** O recurso de saída vem desligado e tem limites que você
  não remove.
- **Não prometa voz idêntica à de uma pessoa, nem ausência de atraso.** Mostre uma ligação real
  antes de fechar. Quem ouviu sabe o que está comprando.
- **Não prometa disponibilidade que você não controla.** A operadora, o provedor de IA e a
  hospedagem podem falhar. Combine o que acontece nesse caso: em geral, a ligação vai para um
  número de uma pessoa.

## Como demonstrar

A demonstração que funciona é uma ligação. Mantenha uma instalação sua, com um número e um
agente de exemplo do ramo do cliente, e peça que ele ligue. Em seguida, mostre a linha do tempo
daquela chamada.

Sem número disponível, a chamada simulada (`pnpm demo`) mostra o caminho inteiro sem chave e sem
operadora. Serve para explicar. Não substitui ouvir.

## O que separa quem dura de quem some

- **Revisar ligações reais toda semana**, no primeiro mês de cada cliente. É onde as instruções
  do agente melhoram.
- **Começar com um caso de uso só.** Atender fora do horário, por exemplo. Ampliar depois.
- **Atualizar as instalações.** Correções de segurança saem para a versão mais recente.
- **Dizer não.** Ao cliente que quer disparo em massa, e ao que quer o agente decidindo o que
  deveria ser de uma pessoa.

## Devolvendo ao projeto

Nada disso é obrigação. Mas o que você aprende em campo é exatamente o que falta ao projeto:

- Uma ferramenta que você escreveu e que serve a outros ramos pode virar contribuição. Veja
  [adicionar uma ferramenta](adicionar-uma-ferramenta.md).
- Um erro de instalação numa hospedagem que ninguém testou é uma issue valiosa.
- Um caso real, com a permissão do cliente, ajuda outros implementadores.
