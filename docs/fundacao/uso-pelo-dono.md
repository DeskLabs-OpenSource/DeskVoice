# Uso pelo dono

> Registro criado em 2026-11-11 pela auditoria de conformidade, a partir do que o dono informou.
> Atualizado em 2026-11-13 com o uso de 12 e 13/11, escrito pela sessão que acompanhou o dono e
> mediu cada caso. Horários em UTC.

## O que aconteceu

| Data | O que o dono tentou | Onde travou | Situação hoje |
|---|---|---|---|
| 2026-11-11 | Entrar no painel | Não achou como criar uma conta | Entregue no PR #5 (equipe, convite por link e troca de senha) |
| 2026-11-11 | Incluir a equipe | Não achou como gerir a equipe | Entregue no PR #5 |
| 2026-11-11 | Ouvir o agente sem ter linha telefônica | Não havia jeito de conversar com o agente pelo painel | Entregue no PR #4. Provado num navegador pelo dono em 2026-11-13 (linha abaixo) |
| 2026-11-12 | Conectar um número de WhatsApp por QR Code no DeskVoice da VPS de teste | Sem domínio, a tela não fica aberta para fora: precisou de um túnel SSH até o painel | Conectou às 11:35. O acesso sem domínio é a decisão 0011 |
| 2026-11-12 | Manter o WhatsApp por QR conectado | A conexão caiu sozinha às 12:18, 43 minutos depois de parear | Investigado em 13/11. O WhatsApp removeu o aparelho (`stream:error` código 401, `conflict type="device_removed"`, no log do WAHA). O WAHA não tinha reiniciado, e diante desse conflito ele mesmo decide não reconectar ("do not reconnect the session"). O painel registrou o aviso de desconexão. Às 12:12:50, cinco minutos antes, o WAHA recebeu a lista de aparelhos do número ("got my own devices"); o log não diz se ela mudou. Não se sabe se a remoção partiu do celular ou do WhatsApp, e a pergunta ao dono está aberta |
| 2026-11-12 | Configurações | A página empilhava 13 blocos, e o dono disse que estava ficando horrível | Entregue nos PRs #117 (sete seções, cada uma com endereço próprio) e #118 (frases que localizavam blocos "nesta página") |
| 2026-11-13 | Parear o número dedicado na ligação pelo WhatsApp, pela tela | Abriu a página do ensaio do WaCalls (já removida) em vez do painel, e achou que tinha caído. Uma tentativa às 23:24 de 12/11 não pareou | Pareado às 02:17 pelo painel, no bloco "Ligação pelo WhatsApp" da página única de Configurações (a divisão em seções do #117 entrou às 04:13), na VPS exclusiva do DeskVoice |
| 2026-11-13 | Falar com o agente pelo navegador, com motor real | — | Chamada de 179 s às 02:21. O agente tentou transferir (não havia número de transferência, e disse isso) e avisou a equipe duas vezes. É a primeira prova num navegador de verdade |
| 2026-11-13 | Ligar para o número pelo WhatsApp e falar com o agente | Primeiro relato: a resposta do agente não chegava ao celular, embora estivesse na gravação e no histórico. Depois o dono corrigiu: chegava, mas mais devagar que pelo navegador | Medido nas gravações: entre o fim da fala de quem liga e o começo da resposta, 0,2 a 1,8 s pelo navegador e 4 a 5 s pelo WhatsApp. A gravação mostra que, nas pausas, nenhum áudio de quem liga chegou ao DeskVoice: o lado de quem liga fica em zero exato, que é como a gravação preenche o tempo sem áudio recebido (`apps/voice/src/recording.ts`, `append`), enquanto pelo navegador as pausas têm o ruído do microfone. Sem áudio, o detector de turno do motor não vê o fim da fala. A explicação provável é que o celular para de mandar áudio no silêncio (transmissão descontínua); isso não foi medido no WaCalls, e a ligação de prova confirma ou não. Consertado no ramo `feat/ligacao-whatsapp-fatia-2` (commit `3bf508f`, teste com sabotagem) e instalado na VPS exclusiva. Falta a ligação de prova do dono depois do conserto |

## O que não está registrado

O dono não percorreu, ou não há registro de que tenha percorrido: cadastrar a linha, responder
uma aprovação e ver o custo. A chave de IA e o agente das chamadas de 13/11 foram configurados,
mas não há registro de quem configurou.

## Itens de conformidade ligados a este registro

8.6 (gestão de equipe pela tela), 6.1 e 6.9 (o que a autenticação não tem), 13.8.
