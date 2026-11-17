---
impact: operator_action
section: changed
title: A senha passa a morar numa conta, separada da organização, e a atualização fica com quem administra a instalação
---

Quem entra no painel continua entrando com o mesmo e-mail e a mesma senha, na mesma organização e
com o mesmo papel. Os aparelhos que já estavam conectados continuam conectados. Nada muda na tela e
não há nada a fazer depois de atualizar. Por trás, a senha sai do cadastro da equipe e passa para
uma conta que nenhuma tela presa a uma organização consegue ler. É o primeiro passo para uma mesma
pessoa cuidar de vários clientes numa instalação só. Pedir a atualização pelo painel passa a ser de
quem administra a instalação, e numa instalação com uma organização são as mesmas pessoas de
antes: o dono e o administrador. A exceção é a instalação que já tinha mais de uma organização,
criada direto no servidor: nela, só os donos ativos da organização mais antiga continuam pedindo a
atualização, e o registro da instalação guarda isso. Se ninguém mais conseguir pedir, o comando
`bash install/grant-installation-admin.sh <e-mail>`, rodado de dentro do servidor, devolve o papel a
uma conta. Crédito: @melgarafael.

## Requer atenção

Depois desta versão, não dá para voltar só trocando a versão. `bash install/update.sh --to 0.27.0`
termina dizendo que está tudo saudável, mas ninguém consegue fazer login no painel, porque a
versão anterior procura a senha onde ela não está mais (quem já estava com o painel aberto
continua). A volta é pelo backup que o atualizador fez na ida para esta versão. Ele é o backup
mais recente cuja versão é a 0.27.0, e o comando abaixo, rodado na pasta do DeskVoice, mostra
qual é. Anote o resultado antes de voltar:

    grep -l '^version=0.27.0$' backups/*/manifest.txt | sort | tail -n 1

Para voltar, troque a versão e depois restaure esse backup, pelo nome da pasta que o comando
mostrou:

    bash install/update.sh --to 0.27.0
    bash install/restore.sh backups/<a pasta que o comando mostrou>

Não use `restore.sh latest` nem o backup que o `update.sh --to 0.27.0` mostra no fim como
"Backup de antes da atualização": esse foi feito na volta, com o banco desta versão, e restaurá-lo
não devolve o login. O backup da ida só fica guardado enquanto a rotação o mantiver, que guarda os
14 mais recentes. A restauração devolve o banco ao momento desse backup: o que entrou depois de
atualizar (ligações, pendências, mudanças feitas no painel) se perde.
