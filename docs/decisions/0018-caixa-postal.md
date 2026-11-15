# 0018: A caixa postal grava o recado depois de um aviso, e só com a gravação ligada

- **Estado:** aceita; passa a valer quando o PR que a traz entrar na `main`
- **Data:** 2026-11-15
- **Quem decidiu:** o dono do projeto, em 15/11/2026 (pedido de decisão "caixa postal", sobre o PR #184 e a issue #172, atualizado com o PR #231; resposta: "Pode seguir com sua recomendação em todos docs de decisao abertos", que vale 1A, 2A, 3A, 4B e 5A)

## Contexto

Uma ligação recebida que não acha quem atenda (o número não tem agente, ou o agente está desligado) era recusada e desligada, e o recado se perdia. O @webtecnica desenhou a caixa postal na issue #172 e listou quatro perguntas ao dono; a sessão revisora acrescentou uma quinta. O PR #184 trouxe a sessão que toca o aviso, grava e encerra, sem quem a chamasse. O PR #231 trouxe o encanamento: a decisão em `inbound.ts`, a sessão própria do recado, a gravação na pasta das gravações e a tela, mas com um bipe só, sem aviso falado, e com chave própria que gravava mesmo com a gravação das chamadas desligada.

A caixa postal grava a voz de quem liga num caminho sem agente, e a gravação vem desligada de fábrica por organização ([0016](0016-gravacao-desligada-de-fabrica.md)). E atender a ligação para gravar o recado passa a gerar minuto pago na operadora que cobra a recebida atendida, onde hoje a recusa não custa nada.

## Decisão

1. **O aviso é um áudio já gravado (escolha 1A).** Antes de gravar, quem liga ouve "No momento, ninguém pode atender. Esta ligação será gravada. Deixe o seu recado depois do sinal." e um bipe, em pt-BR, inglês ou espanhol, no idioma escolhido em Configurações → Ligações (`voicemail.language`, pt-BR de fábrica). O texto não muda pela tela. Os três arquivos ficam em `apps/voice/assets/voicemail-notice/`, gerados com o Piper e vozes de licença livre por `scripts/aviso-da-caixa-postal/gerar.sh` (créditos em [`CREDITS.md`](../../CREDITS.md)).
   - Nada do que quem ligou diz antes de o aviso terminar de tocar entra no arquivo. O transporte põe o aviso na fila e ele sai em quadros de 20 ms; a sessão espera o transporte dizer que a fila esvaziou (`drained`) para começar a gravar quem ligou.
   - O tempo máximo do recado (`voicemail.max_seconds`, de 5 a 300, 60 de fábrica) conta a partir do fim do aviso.
   - O aviso fica no canal do agente da gravação, como a fala do agente numa conversa: o arquivo é a prova do que quem ligou ouviu.
2. **Quem transcreve é a chave do agente do número (escolha 2A).** O recado entra no caminho de toda chamada que termina: o resumo vai para a fila, e com a transcrição automática ligada (`calls.auto_transcription_enabled`, mais a licença `calls.transcription_enabled`) a gravação é transcrita pelo provedor do motor do agente do número, quando há um (o agente desligado). Sem agente no número, não há chave: a linha do tempo do recado diz isso, e o recado fica só em áudio.
3. **O recado não ocupa a vaga de uma conversa, e tem teto próprio (escolha 3A).** O recado não gasta IA e não conta no teto de conversas simultâneas (`inbound.max_concurrent_calls`). Os recados ao mesmo tempo têm o mesmo número como limite próprio: no limite, o recado seguinte recebe ocupado, como a conversa no dela. Sem esse teto, uma rajada para um número sem agente abriria um canal de áudio e um arquivo por chamada. A chamada do recado é marcada na própria linha (`calls.voicemail`), para as duas contagens se separarem desde o momento em que ela nasce.
4. **Sem cifra no disco (escolha 4B).** O recado fica como as gravações das chamadas: sem cifra, no volume `recordings`. O guia de conformidade diz isso com clareza.
5. **A caixa postal obedece à gravação da organização (escolha 5A).** Com `calls.recording_enabled` desligada, não há caixa postal, e a ligação é recusada como antes. Uma chave só diz se esta empresa grava voz. O interruptor da caixa postal (`voicemail.enabled`) continua existindo e vem desligado, porque atender gera custo na operadora; a tela diz as duas coisas e avisa quando a caixa postal está ligada com a gravação desligada.

Além das escolhas, dois ajustes da revisão do PR #231: o fim do recado deixa um aviso no painel (recado novo, atendida sem recado, ou recado que não pôde ser gravado) e enfileira o resumo, que é o caminho do aviso ao responsável pelo WhatsApp. E o tempo gravado se chama `recordedSeconds`, porque inclui o silêncio: não é tempo de fala (revisão do PR #184).

O encanamento, a sessão do recado e a tela são trabalho de @webtecnica no PR #231, com o commit dele preservado, e o desenho é o da issue #172 e do PR #184.

## Alternativas

| Escolha | Alternativa | Por que não |
|---|---|---|
| 1 | B. Voz sintética lendo um texto da tela | Depende de provedor e de chave, e gasta a cada ligação; a caixa postal existe justamente para quando não há agente |
| 1 | Só o bipe, como no PR #231 | Seria a única gravação do produto sem aviso de que está gravando |
| 2 | B. Uma chave de transcrição própria da organização | Mais uma chave e mais uma tela, para o caso do número sem agente |
| 3 | B. O recado conta no teto das conversas | Com o teto atingido, quem liga continua sem onde deixar recado, um dos casos que a caixa postal quer cobrir |
| 3 | Recado sem teto nenhum | Uma rajada abre um canal e um arquivo por chamada |
| 4 | A. Cifrar o áudio já na primeira fase | CPU na gravação e uma chave a mais para guardar e restaurar do backup, e as gravações das chamadas já ficam sem cifra |
| 5 | B. Chave própria da caixa postal, sem depender da gravação | A gravação de voz ficaria ligada por um caminho separado da chave que diz se a empresa grava |

## Consequências

- Quem quer a caixa postal precisa ligar a gravação das chamadas, e com ela passa a gravar também as conversas.
- Atender a ligação gera minuto na operadora que cobra a recebida atendida. A caixa postal nasce desligada, e quem atualiza não passa a atender nada sem decidir.
- O texto do aviso é fixo nos três idiomas. Mudar a frase é gerar os arquivos de novo pelo script e mandar um PR.
- A transcrição do recado manda ao provedor também o aviso, que está no canal do agente, e a linha do tempo mostra o aviso como fala do agente.
- O botão "Transcrever" da tela da chamada usa o motor gravado na chamada, e o recado não tem motor: nele, o botão recusa. O recado com agente é transcrito pela transcrição automática.
- A ligação pelo WhatsApp continua recusando quando não há quem atenda: o áudio vem do provedor, não do AudioSocket, e o recado ali é outra peça.
- Nenhuma ligação real por tronco passou pela caixa postal até esta decisão; o caminho foi provado com um transporte de teste que leva o tempo do aviso para tocar.

## Quando revisar

- Quando alguém pedir outro texto de aviso, outro idioma ou a voz sintética.
- Quando a gravação passar a ter cifra em repouso.
- Quando o recado pelo WhatsApp entrar.
- Em qualquer caso, até 2027-05-15.
