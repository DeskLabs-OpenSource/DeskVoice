---
impact: nothing_changes
section: fixed
title: A ligação recusada por motor que não está instalado não manda mais cadastrar a chave
---

Quando o agente aponta para um motor de voz que a instalação não tem, o aviso no painel agora diz
que o motor não está instalado e manda escolher outro motor na tela do agente, em vez de mandar
cadastrar a chave. Na linha do tempo, a recusa por motor que não está pronto deixa de afirmar
"sem chave cadastrada" quando a chave existe e não pôde ser lida, e aponta para o aviso do
painel, que traz o motivo. Nada a fazer em instalações existentes. Crédito: @melgarafael.
