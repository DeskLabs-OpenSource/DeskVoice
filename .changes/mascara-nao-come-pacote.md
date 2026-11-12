---
impact: nothing_changes
section: fixed
title: A saída do atualizador não esconde mais nome de pacote como se fosse e-mail
---

A máscara que esconde e-mail na saída do atualizador e no arquivo de diagnóstico trocava também nomes de pacote com versão: a linha `> @deskvoice/routines@0.0.0 migrate` aparecia como `> @deskvoice/***@0.0.0 migrate`. Agora só é tratado como e-mail o que termina num domínio de letras, como `empresa.com.br`, e o e-mail de verdade continua escondido. Crédito: @melgarafael.
