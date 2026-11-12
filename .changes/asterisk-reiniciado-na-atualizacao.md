---
impact: nothing_changes
section: fixed
title: A atualização aplica a configuração nova do Asterisk sem derrubar ligações
---

O Asterisk só lê os arquivos de configuração ao recarregar ou reiniciar, e a atualização os regravava sem fazer nenhum dos dois: numa versão que mudasse um deles, as ligações seguiriam com a configuração antiga, e a volta automática não restauraria a anterior. Agora a atualização, na ida e na volta, regrava no lugar o arquivo que mudou e recarrega só o módulo dele, sem derrubar as ligações em andamento; reinicia o Asterisk apenas se recarregar não der certo, e diz por quê. A volta também regera a configuração da versão anterior, e o instalador, rodado de novo, faz a mesma conferência para o Asterisk e para o Caddy. Há uma exceção, uma vez só: até a 0.2.0 o kit trocava esses arquivos por cópias novas, e um Asterisk que já estava de pé quando isso aconteceu (numa atualização, ou com o instalador rodado de novo) continua preso ao arquivo antigo, que recarregar não alcança. Nessa instalação, a primeira atualização que mudar um desses arquivos reinicia o Asterisk uma vez, logo depois das migrations, que já deixam o atendimento parado por alguns instantes. Esta versão não muda nenhum desses arquivos: nada a fazer. Crédito: @melgarafael.
