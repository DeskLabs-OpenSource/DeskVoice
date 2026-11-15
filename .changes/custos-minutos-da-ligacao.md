---
impact: nothing_changes
section: fixed
title: Em Custos, os minutos de cada motor são a duração das ligações, também no OpenAI Realtime
---

O quadro "Por motor" da tela de Custos mostrava os minutos a partir do uso que o motor declara para cobrar. O OpenAI Realtime cobra por token e declara zero segundo, e por isso a linha dele mostrava perto de 0 minuto ao lado de um custo real. Agora os minutos são a duração das ligações que cada motor atendeu, do atendimento ao fim, contando cada ligação uma vez. O custo não muda: ele já era medido certo. Crédito: @melgarafael.
