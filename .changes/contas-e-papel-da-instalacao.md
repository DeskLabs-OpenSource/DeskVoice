---
impact: nothing_changes
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
