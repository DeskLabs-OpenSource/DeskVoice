# 0019: Um link temporário entrega a quem ligou a gravação da própria chamada

- **Estado:** aceita; passa a valer quando o PR que a traz entrar na `main`
- **Data:** 2026-11-15
- **Quem decidiu:** o dono do projeto, em 15/11/2026 (pedido de decisão sobre o PR #176; resposta: "Pode seguir com sua recomendação em todos docs de decisao abertos", que vale a opção A). É decisão do dono porque abre a primeira rota do produto que responde sem login

## Contexto

Quando quem ligou pede a gravação da própria chamada, o caminho era manual: alguém do time baixava o áudio pela tela da chamada e mandava por fora, sem prazo, sem limite e sem registro de entrega. Os dados em texto já saíam pela exportação, em Configurações → Privacidade ([0014](0014-direitos-de-quem-ligou-pela-tela.md)), e a [0016](0016-gravacao-desligada-de-fabrica.md) deixou o áudio fora dela.

A [issue #174](https://github.com/DeskLabs-OpenSource/DeskVoice/issues/174) descreveu três caminhos, e o contribuidor @webtecnica implementou o primeiro no PR #176. Até aqui, todo acesso ao DeskVoice passava por sessão; este caminho abre o primeiro endereço que entrega algo sem login. Depois, no PR #234, o mesmo contribuidor propôs um quarto caminho, que pede a quem abre um código enviado ao número da chamada.

## Decisão

Dono ou administrador cria, na tela da chamada, um link que entrega o áudio daquela chamada a quem tiver o endereço, sem login.

1. **Prazo e usos.** O link vale 72 horas e permite 10 downloads. Esgotado, vencido ou revogado, ele para de servir, e quem abre vê a mesma página de "este link não vale mais", sem saber qual dos casos foi.
2. **O que conta como uso.** Cada download do áudio gasta um. Abrir a página do link não gasta nada: o aplicativo de mensagem que monta a prévia do link ao recebê-lo, e quem recarrega a página, não consomem o que é de quem ligou. A conferência e a soma do uso são uma operação só, e o limite vale também com pedidos simultâneos.
3. **O endereço.** Aparece uma vez, na criação, e o banco guarda só o hash do token. É montado a partir do endereço público configurado da instalação, que o instalador grava, e nunca a partir do endereço pelo qual o pedido chegou. Sem domínio, o painel fica só dentro do servidor ([0011](0011-sem-dominio-o-painel-nao-vai-para-a-internet.md)), e o link não abre para quem está fora; a tela diz isso.
4. **A página.** Quem recebe o link vê uma página em pt-BR, inglês ou espanhol, com o início e o fim da chamada, a validade, os downloads que restam e o botão de baixar. Não mostra telefone, nome, fala nem resumo.
5. **Revogar.** A tela da chamada lista os links que ainda valem, com validade e usos, e revoga todos de uma vez, depois de confirmar.
6. **Apagamento e prazo de guarda.** Chamada apagada a pedido de quem ligou não gera link, e o link criado antes do apagamento deixa de servir. Gravação que sai pelo prazo de guarda faz o link cair na mesma página de "não vale mais".
7. **Registro.** Criar, revogar e cada download ficam em `organization_events`, e aparecem no registro de Configurações → Privacidade.
8. **O aviso a quem cria.** A tela diz que qualquer pessoa com o link baixa o áudio, que tem também a voz do agente. Para quem o link é mandado, e por qual canal, é processo de quem opera.

O desenho do token, a tabela, a rota pública e os testes de partida são o trabalho de @webtecnica no PR #176, com os commits dele preservados.

## Alternativas

| Alternativa | O que é | Por que não |
|---|---|---|
| B. Áudio dentro da exportação | Um `.zip` com o NDJSON e os `.wav`, sem rota pública | O arquivo sai por e-mail ou WhatsApp e vira uma cópia sem prazo, sem registro de quem abriu e sem como recolher |
| C. Envio pelo WhatsApp do produto | O áudio vai como mensagem para o número da chamada | Tem os mesmos problemas da B e ainda depende de o número estar no WhatsApp |
| D. Link com prova de posse do número (PR #234) | Quem abre digita um código enviado ao número da chamada | Exige um passo a mais de quem ligou e de quem opera, não serve a quem ligou de telefone fixo sem WhatsApp, e a prova é de posse do número que aparece na chamada, não de quem ligou. A A entrega com prazo, limite, registro e revogação sem esse passo |
| Contar a abertura da página como uso | Cada visita à página gasta um dos 10 | A prévia do aplicativo de mensagem e cada recarregar gastariam o que é de quem ligou, e "10 usos" viraria bem menos downloads |

## Consequências

- É a primeira rota do produto sem login. Qualquer rota pública nova passa a ter este registro como referência do que ela precisa: resposta igual para todos os casos de falha, endereço que vem da configuração da instalação e registro do que foi entregue.
- O link não amarra quem abre a quem ligou: quem tiver o endereço baixa o áudio. A tela avisa quem cria.
- **Não está coberto:** um leitor de links de e-mail ou de mensagem que siga o botão de baixar da página gasta um uso, porque o download é um `GET` como outro qualquer. Abrir a página não gasta; seguir o botão, sim. Por qual canal o link chega a quem ligou é escolha de quem opera, por fora do produto.
- Atrás de um proxy do operador, na frente do Caddy da instalação, o endereço do link pode ficar no log desse proxy. O guia de [conformidade](../guides/conformidade-brasil.md) diz isso.
- Cada download vira uma linha do registro de Privacidade, que mostra as 50 mais recentes. Um link muito usado ocupa parte desse registro.
- Nada muda para quem atualiza: sem criar um link, nenhuma rota pública entrega nada.

## Quando revisar

- Quando alguém pedir prova de que quem abre é quem ligou.
- Quando outra rota pública for proposta.
- Em qualquer caso, até 2027-05-15.
