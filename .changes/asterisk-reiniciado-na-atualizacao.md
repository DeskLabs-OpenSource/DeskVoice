---
impact: nothing_changes
section: fixed
title: A atualização passa a reiniciar o Asterisk quando a configuração dele muda
---

O Asterisk só lê os arquivos de configuração ao reiniciar, e a atualização os regravava sem reiniciá-lo: numa versão que mudasse um deles, as ligações seguiriam com a configuração antiga, e a volta automática não restauraria a anterior. Agora a atualização, na ida e na volta, compara o que o Asterisk tem em uso com o que está no disco e o reinicia só se algum arquivo for diferente, porque o reinício derruba as ligações em andamento. A volta também regera a configuração da versão anterior. O instalador, rodado de novo, faz a mesma conferência para o Asterisk e para o Caddy. Até esta versão nenhum desses arquivos mudou entre versões; nada a fazer. Crédito: @melgarafael.
