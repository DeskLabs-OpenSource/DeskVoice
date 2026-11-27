---
impact: new_capability
section: added
title: No pipeline, o "aham" e o "sim" de quem ligou não cortam mais a resposta do agente
---

Quem ligou costuma dizer "aham", "sim" ou "tá" enquanto o agente do pipeline fala, só para mostrar que está ouvindo. Antes, qualquer texto novo cortava a resposta no meio. Agora, enquanto a voz ainda gera a resposta do agente, o trecho que só tem palavras de concordância do idioma do agente (português, inglês ou espanhol) não corta: ele entra na transcrição e vai ao cérebro no próximo pedido. Basta uma palavra de fora, como "não", "mas" ou "espera", para o agente parar como antes. Idioma sem lista segue cortando em tudo. O fim da fala fica de fora: depois que a voz termina de gerar a resposta, o áudio ainda toca para quem ligou, e um "aham" dito ali vira turno, como antes, e o agente responde a ele. A lista é uma primeira versão: quantas concordâncias ainda cortam, quantas interrupções ela engole e quanto dura o fim da fala não foram medidos, e as listas de inglês e espanhol não foram revistas por falante nativo. Só vale para o motor Pipeline: os outros motores seguem como eram, e quem já instalou não precisa fazer nada. Crédito: @melgarafael.
