---
impact: nothing_changes
section: added
title: Para quem contribui, o Claude Code implementa uma fatia de desenho com um verificador separado
---

Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. No Claude
Code, `/deskvoice-fatia <desenho> <número>` lê a fatia de um desenho de `docs/specs/`, cria um
worktree descartável, chama um implementador com o contrato e o aceite palavra por palavra e depois
um verificador que não pode escrever e tenta derrubar a entrega, até ele aprovar ou até três
voltas. O comando não envia nada ao GitHub: o ramo fica local, e abrir o PR é com a pessoa. O aviso
de identidade do commit passa a olhar o e-mail que o commit vai gravar de fato, e não só o do
`git config`: some o aviso falso de quem passa o e-mail certo pelo ambiente, e aparece o de quem
recebe um `root@` de lá. Crédito: @melgarafael.
