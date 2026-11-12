# 0016: A gravação do áudio vem desligada de fábrica

- **Estado:** aceita
- **Data:** 2026-11-12
- **Quem decidiu:** o dono do projeto, em 12/11/2026 (pedido de decisão sobre o PR #97; resposta: "Pode seguir sua recomendação nas decisoes em aberto", que vale a opção B)

## Contexto

O contribuidor @aliffstefano propôs no PR #97 a gravação do áudio de toda chamada: um WAV estéreo por chamada (quem ligou num canal, o agente no outro), servido na tela da chamada e apagado pelo prazo de guarda das conversas ([`0014`](0014-direitos-de-quem-ligou-pela-tela.md)). A gravação é montada na sessão de chamada e serve a todo transporte: tronco SIP, navegador e simulação.

Como estava, toda instalação que atualizasse passaria a gravar sem ninguém decidir. Isso contraria a regra 7 do [`GOVERNANCE.md`](../../GOVERNANCE.md), quem já instalou não é surpreendido, e muda o que a empresa faz com dado pessoal de quem liga: o áudio é a voz da pessoa, e quem responde por ele é cada organização, não a instalação. O próprio PR deixou a pergunta ao dono: ligada por padrão, ou desligada até alguém ligar em Configurações.

## Decisão

A gravação vem desligada e se liga pela tela, por organização, só por dono ou administrador. Cada mudança fica registrada.

1. **Interruptor.** Mora em Configurações, no mesmo painel do prazo de guarda, em "Gravação das chamadas". A chave é `calls.recording_enabled` em `settings`; ausente é desligada, e só `true` liga. Muda por `PUT /privacy/recording` (`{ enabled: boolean }`, validado com zod), nunca pela rota genérica de configurações, e cada mudança grava `call_recording_changed` em `organization_events`, com quem mudou e `{ from, to }`.
2. **Quando grava.** A sessão de chamada lê o interruptor da organização da chamada no começo dela, dentro de `withOrg`. Desligado, ou sem `RECORDINGS_DIR`, o gravador nem é montado: nenhum buffer de áudio é guardado em memória. Mudar no meio de uma chamada vale a partir da próxima.
3. **Grava em disco durante a chamada.** O áudio sai em blocos de cerca de 1 s para `<call_id>.wav.part`, com um cabeçalho WAV provisório; em memória fica só o trecho que ainda pode mudar (o último segundo e a fala do agente que ainda vai tocar). No fim, o cabeçalho recebe os tamanhos e o arquivo vira `.wav`. Sem áudio, ou se a escrita falhou, o `.part` é apagado no fim da sessão. Se o processo de voz cair no meio, o `.part` que ficou é apagado quando ele sobe de novo, antes de atender. A primeira versão do #97 guardava a chamada inteira em memória e copiava o acumulado a cada pedaço da fala do agente: o custo crescia com o tamanho da chamada, dentro do processo que toca o áudio em tempo real.
4. **Piso de disco.** Antes de abrir o arquivo, a sessão confere o espaço livre na pasta (`statfs`). Abaixo de 1 GiB, a chamada segue sem gravar e grava `recording_skipped` (`{ reason: "low_disk", freeBytes, minFreeBytes }`) na linha do tempo; se a pasta não puder ser usada, `{ reason: "unavailable", error }`. O piso existe porque as gravações dividem o disco com o Postgres: disco cheio para o banco, o que é pior que uma chamada sem áudio. 1 GiB são cerca de 9 horas de gravação.
5. **Ligar e desligar não apagam nada.** O que já foi gravado segue o prazo de guarda das conversas: sai junto com o texto, e sem prazo fica para sempre. A tela diz isso. Por não apagar, o interruptor não pede confirmação ([`destrutivo-pede-confirmacao.md`](../doctrine/destrutivo-pede-confirmacao.md)).
6. **Custo em disco.** A tela diz "cerca de 1,9 MB por minuto de chamada" e diz que é a conta do formato (estéreo, 8 kHz, 16 bits: 32 000 bytes por segundo), e não uma medição. Com a gravação ligada e o prazo de guarda vazio, a tela avisa que o disco cresce sem limite e sugere um prazo.
7. **Exportação.** `POST /privacy/export` diz, em cada chamada, se há gravação (`recording: true | false`), conferindo o arquivo no disco: o prazo pode já ter apagado o áudio de uma chamada gravada. O áudio não vai no NDJSON. Embutido em base64, cada minuto de conversa somaria cerca de 2,5 MB a um arquivo de texto que a tela baixa de uma vez; quem pede o áudio o recebe pela tela da chamada.

O gravador, a rota que serve o áudio, o expurgo pelo prazo e o volume do Compose são o trabalho de @aliffstefano no PR #97, com os commits dele preservados.

## Alternativas

| Alternativa | O que é | Por que não |
|---|---|---|
| A. Ligada por padrão, como no PR #97 | Toda instalação grava ao atualizar | Surpreende quem já instalou e decide pela empresa o que fazer com a voz de quem liga |
| Interruptor da instalação | Uma variável de ambiente ou um ajuste único no instalador | Exige SSH (regra 4) e decide por todas as organizações de uma vez |
| Prazo próprio para o áudio | Um segundo prazo de guarda, só para as gravações | O áudio é a mesma conversa que o texto; dois prazos abrem espaço para o texto sair e a voz ficar. Fica para quando alguém pedir |
| Áudio dentro da exportação | O WAV em base64 em cada linha de chamada | Faz o arquivo de texto crescer cerca de 2,5 MB por minuto, e o navegador o monta inteiro na memória |

## Consequências

- Uma falha de escrita no meio da chamada (o disco encheu depois do piso, por exemplo) perde a gravação daquela chamada e fica só no log do processo de voz, sem evento na linha do tempo.
- Quem atualiza continua sem gravar até alguém ligar. A nota de versão diz onde se liga.
- Os backups de hoje (`install/backup.sh`) guardam o banco, os arquivos de ambiente e os troncos gerados, e **não incluem o volume `recordings`**. Restaurar um backup em outro servidor traz as chamadas sem o áudio. O guia de conformidade diz isso.
- A gravação desligada no meio do caminho deixa as chamadas antigas com áudio e as novas sem; a tela da chamada diz "Esta chamada não tem gravação." nas que não têm.
- O aviso do começo da ligação é o mesmo com ou sem gravação. O texto padrão diz que a conversa fica registrada; quem grava confere se o seu texto diz isso a quem liga.

## Quando revisar

- Quando alguém pedir prazo próprio para o áudio, ou o áudio na exportação.
- Quando os backups passarem a incluir as gravações.
- Em qualquer caso, até 2027-05-12.
