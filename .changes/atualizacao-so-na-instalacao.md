---
impact: nothing_changes
section: changed
title: A tela de atualizar mora só em "Administrar a instalação" › "Atualização", e /settings/system leva até ela
---

A tela de versão e atualização deixa de morar em Configurações, também na instalação com uma organização só: ela fica em "Administrar a instalação" › "Atualização" (`/installation/update`) para quem administra a instalação, com a lista de quem administra explícita ou não. O cartão "Sistema" sai da central de Configurações. O endereço antigo, `/settings/system`, continua valendo: leva quem administra a instalação à tela nova, e quem não administra de volta a Configurações. Quem não administra a instalação vê a versão na lateral sem link, como já via com a lista explícita. A atualização em si, a rota da API e quem pode pedir não mudam. Nada a fazer ao atualizar. Crédito: @melgarafael.
