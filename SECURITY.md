# Política de segurança

## Como relatar uma vulnerabilidade

**Não abra issue pública para vulnerabilidade.**

Use o relato privado do GitHub:
[abrir um aviso de segurança](https://github.com/DeskLabs-OpenSource/DeskVoice/security/advisories/new).
O relato chega só aos mantenedores, e o histórico fica auditável.

O que esperar:

- **Confirmação de recebimento** em até 7 dias.
- **Avaliação e resposta** em até 30 dias, com plano de correção quando a falha for confirmada.
- **Crédito** no aviso publicado, se você quiser.

Ajuda muito se o relato trouxer: a versão ou o commit, os passos para reproduzir e o que um
atacante consegue fazer. Não inclua dados reais de terceiros, como números de telefone ou
transcrições.

## Versões suportadas

Correções de segurança saem para a versão mais recente publicada. Mantenha a sua instalação
atualizada.

| Versão | Recebe correção |
|---|---|
| A mais recente publicada | Sim |
| Anteriores | Não |

## Escopo

Interessam em especial relatos sobre:

- **Vazamento entre organizações:** dado de uma organização lido ou alterado por outra,
  contornando a camada de isolamento.
- **Autenticação e sessão do painel:** entrar sem credencial, elevar papel, reutilizar sessão.
- **Segredos:** senha de tronco, chave de IA ou chave de cifra expostas em resposta de API, log,
  evento ou backup.
- **Controle da telefonia:** qualquer forma de originar, transferir ou escutar chamada sem
  permissão, ou de alcançar a interface de controle do Asterisk de fora.
- **Ligações de saída:** originar chamada com a política desligada, ou contornar teto, janela
  de horário ou lista de não ligar.
- **Aprovação humana:** fazer o agente executar o que dependia de aprovação sem que alguém
  tenha aprovado.
- **Webhooks:** fazer a ferramenta de webhook alcançar endereço interno ou não cadastrado.
- **Instalador e atualização:** execução de comando ou escrita de arquivo fora do previsto.

Fora do escopo do projeto: configuração do servidor de quem hospeda (firewall, sistema
operacional, acesso SSH) e falhas dos provedores de IA ou de telefonia. Melhorias no instalador
que tornem o padrão mais seguro são bem-vindas como issue comum.

## A porta de controle do Asterisk nunca é publicada

O DeskVoice comanda o Asterisk pela interface ARI. Quem alcança essa interface controla as
chamadas da instalação. Por isso:

- **A porta do ARI só existe na rede interna do Docker.** A instalação padrão não a publica, e
  nenhum guia do projeto pede que você a publique.
- O mesmo vale para a porta do AudioSocket e para o Postgres.
- Para fora, a instalação expõe o painel (80 e 443), a sinalização SIP e a faixa de áudio RTP.
  Nada mais.

Se você alterar os arquivos de implantação, não acrescente publicação de porta para o ARI. Se
encontrar uma instalação padrão em que ele esteja acessível de fora, isso é uma vulnerabilidade:
relate.

## Limites conhecidos desta fundação

Preferimos dizer o que ainda não está fechado a deixar alguém descobrir em produção.

- **Troca de organização por injeção de SQL.** O isolamento entre organizações é feito no banco
  (RLS) a partir de um valor que a própria conexão define. Se um dia existir uma falha de injeção
  de SQL numa consulta, quem a explorar e souber o identificador de outra organização consegue
  trocar de organização. Hoje as consultas são parametrizadas e uma cerca reprova SQL fora de
  `packages/core`. Fechar de vez pede outro desenho, e é uma frente aberta no roadmap.
- **Limite de tentativas de login em memória.** Vale por processo do painel. Reiniciar o painel
  zera a contagem.
- **Tarefa atrasada pode rodar duas vezes.** A recuperação de tarefa presa mede a idade pelo
  horário agendado, não pelo horário em que foi pega. As rotinas da fundação são seguras de
  repetir; rotina nova precisa ser também.
- **Motor de voz caído não fala.** Quem está na linha ouve um sinal de aviso e é transferido ou
  desligado. Uma mensagem gravada é melhor e ainda não existe.
- **Nada foi provado com operadora real.** A conversa inteira roda em simulação e a configuração
  carrega num Asterisk de verdade, mas nenhuma ligação por tronco SIP foi feita. Veja a tabela
  "O que ele faz hoje" no [README](README.md).

## Responsabilidade de quem hospeda

Cada instalação é operada por quem a instalou. Atualizar o sistema, restringir o acesso SSH,
guardar backup fora da máquina e proteger as contas dos provedores é responsabilidade do
operador.
