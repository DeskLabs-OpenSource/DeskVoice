---
impact: nothing_changes
section: fixed
title: Um segundo clone na mesma máquina não mexe mais na instalação de outra pasta
---

Todo clone do DeskVoice manda nos mesmos contêineres, porque o nome do projeto no Docker é fixo. Rodar o instalador, o `update.sh`, o `restore.sh` ou o `backup.sh` de uma segunda cópia do repositório na mesma VPS gerava segredos novos, ou trocava a versão e o banco da instalação que roda a partir da outra pasta. Agora esses scripts, a checagem de saúde e o instalador em modo de simulação conferem antes de tocar em qualquer coisa: se já há um DeskVoice nesta máquina, rodando ou parado, e ele foi instalado de outra pasta, param e dizem qual pasta é a dona e o comando a rodar de lá. Quem roda sempre da mesma pasta não percebe diferença. Crédito: @melgarafael.
