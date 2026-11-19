---
impact: nothing_changes
section: fixed
title: A simulação do DOCKER-USER diz que o serviço ficaria ativo já, e não só no boot
---

O `bash install/docker-user.sh --dry-run apply <portas>` agora diz que gravaria o serviço `deskvoice-docker-user` e o ligaria agora e no boot, igual ao que o `apply` de verdade faz desde a versão anterior. Antes, a simulação dizia só "no boot". Muda apenas o texto; nada a fazer. Crédito: @webtecnica.
