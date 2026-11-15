---
impact: new_capability
section: added
title: Nomes e termos na tela do agente, como dica de reconhecimento ao provedor de voz
---

A tela do agente ganha o campo "Nomes e termos": nomes de pessoas, da empresa, de produtos e termos
que quem liga costuma dizer, um por linha, com o contador "N de 50". A lista vai ao provedor de voz
como dica para reconhecer essas palavras na transcrição, e o provedor pode não seguir a dica. A
regra é a mesma da API (até 50 termos de até 60 caracteres, sem linha em branco, sem repetição e sem
`<`, `>` ou caractere de controle), e o erro aparece ao lado do campo, sem salvar. Quem não
preencher não vê diferença: o agente continua sem vocabulário.
Crédito: @melgarafael.
