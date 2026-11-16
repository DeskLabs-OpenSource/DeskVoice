---
impact: nothing_changes
section: added
title: Para quem contribui, o Claude Code ganha uma triagem de PR que só lê
---

Nada muda para quem opera uma instalação: isto é para quem clona o projeto e revisa PRs. No
Claude Code, `/deskvoice-triagem-de-pr <número>` baixa o PR num worktree descartável, mede o diff
contra a régua da `main` (o que o CI não vê, os antipadrões e as regras de produto), roda a suíte
se a pessoa autorizar, passa o resultado por um cético e imprime um rascunho de parecer no formato
do `GOVERNANCE.md`, com o que não foi medido. Ele não publica nada no GitHub: quem publica, se
quiser, é a pessoa. PR que toca instalador, workflow, imagem, dependências, autenticação,
isolamento ou atualização sai com "pede segunda leitura de um mantenedor". Crédito: @melgarafael.
