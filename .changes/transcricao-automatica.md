---
impact: new_capability
section: added
title: "Transcrição automática da gravação ao fim da chamada"
---

Ligada em Configurações (`calls.transcription_enabled`, desligada de fábrica), a gravação que terminou sem texto agora é transcrita sozinha ao fim da chamada, lado a lado: o que a pessoa disse e o que o agente disse, cada um com o seu dono na linha do tempo. O resumo, o desfecho e o aviso ao responsável passam a ser feitos depois do texto existir — é o que permite ler o recado no painel em vez de ouvir um áudio. Idempotente por origem `stt`, respeita o prazo de guarda, o apagamento a pedido do titular, o teto de custo do agente e o limite de tamanho do provedor; falha do provedor vira motivo na linha do tempo, nunca devolve a tarefa à fila para pagar duas vezes. Crédito: @webtecnica.
