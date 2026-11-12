---
impact: nothing_changes
section: changed
title: As imagens de voz e de rotinas passam a dividir a mesma base, e cada versão ocupa cerca de 900 MB a menos no servidor
---

Os processos de voz e de rotinas saem da mesma base (as dependências e os pacotes do núcleo), mas até a 0.3.0 cada imagem era montada separadamente, e a base saía duas vezes, com marcações diferentes: o servidor baixava e guardava as duas cópias. Na 0.3.0, as duas dividiam 5 de 18 camadas. A partir desta versão as três imagens são montadas juntas, e voz e rotinas diferem só no último passo. Quem atualiza baixa menos, e cada versão ocupa menos disco. Nada a fazer em instalações existentes. Crédito: @melgarafael.
