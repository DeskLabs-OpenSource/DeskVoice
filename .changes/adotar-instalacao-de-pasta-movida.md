---
impact: new_capability
section: added
title: Uma instalação cuja pasta foi movida pode ser adotada pela pasta nova, sem perder os dados
---

Os scripts do kit param quando a instalação desta máquina foi feita a partir de outra pasta. Se essa pasta não existe mais (a instalação foi movida, ou passou para outro usuário), a mensagem agora diz isso, em vez de mandar a pessoa para uma pasta que não está lá, e diz como adotar. Copie `deploy/.env`, `deploy/app.env` e `deploy/migrate.env` da pasta antiga (ou do backup dela) para a nova e rode `DESKVOICE_ADOPT=yes bash install/install.sh` (ou `--adopt`): o instalador recria os contêineres a partir da pasta nova, com os mesmos volumes, onde ficam o banco, os certificados do HTTPS e o pareamento do WhatsApp. Sem os três arquivos ele para antes de tocar em qualquer coisa, porque com segredos novos o banco recusaria a conexão; com a pasta antiga ainda existindo, também para, e manda rodar de lá. Crédito: @melgarafael.
