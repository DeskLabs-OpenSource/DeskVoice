---
impact: nothing_changes
section: changed
title: "A tecla de quem liga passa a chegar à conversa"
---

O `CallTransport` passou a expor `onDtmf`, ligado ao que o AudioSocket já entregava: a tecla que a pessoa aperta chega a quem está conduzindo a chamada, e não morre mais no processo. A ligação pelo WhatsApp, que não tem teclado, continua sem declarar — é opcional. Nenhum comportamento muda para quem só usa o agente de IA; esta é a peça que faltava para um menu por teclas. Crédito: @webtecnica.
