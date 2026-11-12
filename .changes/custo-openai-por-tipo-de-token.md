---
impact: nothing_changes
section: fixed
title: O custo estimado das chamadas com OpenAI Realtime bate com a fatura
---

O custo de cada chamada com o motor OpenAI Realtime era estimado cobrando todo token de entrada como áudio novo, a US$ 32 por milhão. Só que a cada resposta a OpenAI reconta a conversa inteira, e quase tudo isso vem do cache (US$ 0,40 por milhão) ou é texto, como as instruções do agente (US$ 4). Numa ligação real de dois minutos, o painel mostrou US$ 1,31 e a fatura foi de cerca de US$ 0,20, e o teto de custo do agente derrubou a ligação no meio. Agora a estimativa separa áudio, texto e cache com os preços da página da OpenAI. Gemini Live não muda. Crédito: @aliffstefano.
