---
impact: nothing_changes
section: changed
title: Os hooks de contribuição armados não mudam com o ramo em que você está
---

Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. O
`arm-hooks.sh` da skill `deskvoice-contribuir` agora copia os hooks de git para dentro do `.git`
do clone, e eles ficam iguais em qualquer ramo e em qualquer worktree; quando os hooks mudarem na
`main`, arme de novo estando na `main` atualizada. Se você já tinha armado os hooks, rode de novo
`bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh`, e o lembrete de início de sessão
avisa enquanto isso não for feito. Crédito: @melgarafael.
