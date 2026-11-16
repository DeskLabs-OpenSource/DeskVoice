---
impact: nothing_changes
section: added
title: Para quem contribui, as skills aparecem no Codex e o guia de contribuição explica o pré-voo
---

Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. Cada skill
de `.agents/skills/` ganhou `agents/openai.yaml`, o arquivo pelo qual o Codex mostra a skill e a
carrega sozinho, e uma cerca reprova a skill nova que nascer sem ele. A skill `deskvoice-contribuir`
ganhou duas referências: o pré-voo item a item (o que cada linha do `preflight.sh` quer dizer e o
que fazer quando ela acusa) e a receita para rodar na própria máquina os testes de banco, a chamada
simulada e os testes de tela. O hook `pre-commit` passa a avisar, sem bloquear, quando o commit vai
sair com e-mail de máquina (`root@vps-…`), que não dá crédito a ninguém no GitHub. Crédito: @melgarafael.
