---
impact: nothing_changes
section: added
title: A base da transcrição ao vivo da fala de quem liga, ainda desligada
---

Primeiro passo para o agente entender com mais precisão o que a pessoa falou (roteiro R12). O
DeskVoice ganhou o lugar de uma peça de transcrição em streaming, que ouve o mesmo áudio que o motor
de voz recebe, ao lado dele: o contrato da peça, um transcritor simulado sem chave para testes e
demonstração, e a ligação na conversa. Com uma peça escolhida, cada pedaço de áudio de quem ligou vai
ao motor e à peça, sem que o motor espere por ela; cada trecho de texto novo avisa a guarda contra o
silêncio de que a pessoa está falando; o consumo da peça entra no custo da chamada, com linha própria
no extrato, e conta para o teto. Quando a ligação passa a outro agente, a peça é do trecho, como o
motor: com a mesma peça e a mesma abertura, a conexão segue sem reabrir e o consumo daí em diante vai
para o agente novo; senão, a antiga fecha na troca e a do agente novo abre sem segurar a passagem. Se a peça não abre ou cai no meio, a chamada segue só com o motor e
a linha do tempo diz o motivo, sem repetir o texto do provedor, em português, inglês e espanhol.
Nada muda para quem atualiza: ainda não existe onde escolher a peça, e sem peça escolhida a chamada é
a mesma de antes. A escolha na tela e a peça de um provedor de verdade vêm nas próximas fatias. Crédito: @melgarafael.
