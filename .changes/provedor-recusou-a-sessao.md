---
impact: nothing_changes
section: fixed
title: A ligação recusada pelo provedor de voz não manda mais cadastrar uma chave que já existe
---

Quando o provedor de voz recusava a sessão com a chave cadastrada, por exemplo porque o crédito
pré-pago acabou ou porque recusou a chave, a ligação era registrada como "motor de voz sem chave
cadastrada", e o aviso no painel mandava cadastrar a chave. Agora essa recusa tem motivo próprio
na linha do tempo, "o provedor do motor de voz recusou a sessão", e o aviso traz o motivo que o
provedor deu e manda conferir o crédito e os limites na conta do provedor, além da chave. A
ligação sem chave cadastrada continua com o aviso de antes. Nada a fazer em instalações
existentes. Crédito: @melgarafael.
