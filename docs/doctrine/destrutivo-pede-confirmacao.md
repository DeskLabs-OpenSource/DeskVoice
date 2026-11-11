# Doutrina da ação destrutiva

> Lei sobre **o clique que apaga**: toda ação que destrói trabalho pede confirmação, e a
> confirmação diz o que vai embora. Vale para a tela, para os scripts de operação e para o que o
> agente faz durante uma chamada.

## O princípio-raiz

A pergunta não é "esta ação é perigosa?". Quem escreveu o botão responde "não" para o próprio
botão. A pergunta é:

> **"Se este clique estiver errado, o que o operador perde?"**

Se a resposta inclui algo que ele não refaz de memória, o clique não pode ser o primeiro e
único. O custo é assimétrico: confirmar custa um segundo, e perder o trabalho custa a tarde.

## De onde vem a regra

A doutrina nasceu no DeskcommCRM. Lá, dois botões de lixeira idênticos dividiam o mesmo canto de
uma tela: um apagava o item selecionado, o outro apagava o fluxo inteiro. Só um deles pedia
confirmação. Quem aprendeu a confiar naquele canto confiava com metade da proteção.

A lição: o defeito não era o botão. Era a assimetria. Duas ações destrutivas vizinhas não podem
ter contratos diferentes.

## A régua

| A ação | Confirmação |
|---|---|
| Não apaga trabalho: salvar, ativar, desativar, testar o tronco | Nenhuma. Atrito que não protege ninguém é só atrito |
| Apaga trabalho: excluir agente, tronco, número, entrada da lista de não ligar | Obrigatória, com o **alvo nomeado** |
| Apaga em cascata ou tira algo do ar: excluir um agente que atende um número, restaurar um backup por cima do banco atual | Obrigatória, dizendo **o que vai junto** e que **não há como desfazer** |

O alvo nomeado é metade da regra. "Tem certeza?" não informa nada: quem clicou por engano
confirma de novo pelo mesmo motivo que errou. "Excluir o agente Recepção?" é uma pergunta que só
faz sentido se era isso mesmo que a pessoa queria.

## O que conta como destrutivo no DeskVoice

Além do óbvio, três casos próprios de uma central telefônica:

1. **Tirar uma linha do ar.** Excluir ou desvincular o agente de um número faz o telefone parar
   de ser atendido. A confirmação diz isso: "As ligações para este número deixarão de ser
   atendidas."
2. **Remover alguém da lista de não ligar.** Não apaga trabalho, mas desfaz uma proteção pedida
   por uma pessoa. Pede confirmação, com o número nomeado.
3. **Restaurar um backup.** Substitui tudo o que entrou depois dele. Quem restaura precisa ver
   qual backup é e o que será substituído antes de confirmar.

Desativar, quando existe, é preferível a excluir. Um agente desativado para de atender e
continua com o histórico. Se a tela oferece os dois, o texto da exclusão lembra que desativar
existe.

## Como aplicar na tela

1. O botão destrutivo **só abre o diálogo**. Ele nunca executa.
2. O título nomeia o alvo no vocabulário da tela.
3. A descrição diz a consequência em uma frase: o que vai junto, o que para de funcionar e se há
   como desfazer.
4. As ações são "Cancelar" e o verbo do que vai acontecer ("Excluir"). Nunca "Sim", "OK" ou
   "Confirmar".
5. Tom calmo. Sem maiúsculas, sem exclamação. O fato basta.

Exemplo:

> **Excluir o agente Recepção?**
> O número +55 31 5555-0100 ficará sem agente e as ligações para ele deixarão de ser atendidas.
> O histórico de chamadas continua. Esta ação não pode ser desfeita.
> [Cancelar] [Excluir]

## Como aplicar nos scripts

- Script que apaga ou sobrescreve dado mostra o alvo com **caminho absoluto** e pede
  confirmação antes de agir.
- Nenhum script de operação diz "pronto" antes de conferir o resultado. A restauração compara
  contagens antes de dizer "restaurado".
- Pular a confirmação, quando for possível, é sempre uma escolha explícita de quem roda o
  comando, e nunca o padrão.

Para agentes de código, a regra é mais estrita e está na
[doutrina de operação de agentes](operacao-de-agentes.md).

## Como aplicar ao agente de voz

Uma ferramenta que cancela, apaga ou cobra em nome de quem ligou é uma ação destrutiva feita
por um agente. A confirmação, nesse caso, tem duas formas:

- **Confirmação de quem ligou**, em voz, nomeando o alvo: "Vou cancelar a consulta de quinta às
  14h. Confirma?"
- **Aprovação de um humano da equipe**, com `request_approval`, quando o dono do negócio não
  quer que o agente decida sozinho.

A descrição da ferramenta diz ao modelo qual das duas é exigida.

## Verificação

Não há cerca para esta regra, porque decidir o que é destrutivo pede julgamento. Ela é cobrada:

- no teste da tela: nada é apagado antes da confirmação, cancelar não apaga, confirmar apaga uma
  vez, e o diálogo nomeia o alvo;
- na revisão de quem acrescenta o próximo botão destrutivo.
