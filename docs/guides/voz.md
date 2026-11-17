# Voz do agente (ElevenLabs)

O motor de voz em pipeline (desenho `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`) separa a
voz do agente do cérebro e da transcrição. A primeira voz de fora é a da **ElevenLabs**.

**Nesta versão, só a chave e a lista de vozes.** O agente ainda não fala pela ElevenLabs: escolher
a voz no agente é uma fatia posterior. Gravar a chave já testa a conta e mostra as vozes, para
quando a escolha chegar.

A ElevenLabs é opcional. Sem chave, nada muda: nenhum pedido sai, e quem já instalou não vê
diferença além da seção nova em Configurações.

## Cadastrar a chave

Em **Configurações → Voz**, ao lado de **Cérebros**. Só dono ou administrador muda.

1. Leia o aviso **Para onde vai o texto** (o que ele diz está logo abaixo, em "O que a ElevenLabs
   diz que faz com o texto").
2. Cole a chave da ElevenLabs (<https://elevenlabs.io/app/settings/api-keys>).
3. Marque a confirmação: "O texto que o agente fala na ligação vai para a ElevenLabs. Ele pode
   repetir o que a pessoa disse, como nome, endereço e telefone."
4. Clique em **Salvar e testar**. A chave fica cifrada no banco e nunca volta para a tela. O teste
   pede uma voz da conta (`GET /v2/voices`), que não gasta caractere, e diz o resultado: aceita,
   recusada, sem crédito, e assim por diante.

Sem a confirmação, a chave não é gravada. Quem confirmou e quando ficam guardados, e o **Registro**
da seção Privacidade ganha a linha "Fulana confirmou que a voz ElevenLabs recebe o texto que o
agente fala na ligação". Essa linha fica mesmo depois de a chave ser apagada ou de a pessoa sair da
equipe.

Remover a chave apaga a confirmação. Uma chave nova pede a confirmação de novo, com uma linha nova
no Registro. Testar de novo a mesma chave não pede confirmação nem cria linha.

## As vozes

Com a chave aceita, a seção mostra as vozes que a conta já tem, com os idiomas que a ElevenLabs
declara verificados para cada uma. As de português do Brasil vêm primeiro. O botão de ouvir toca a
amostra que a própria ElevenLabs hospeda (`preview_url`): **não gasta crédito**. O DeskVoice não
guarda áudio nenhum, nem a lista: ela é lida da conta a cada vez que a seção a pede.

## O que sai do servidor

Quando a voz estiver ligada no agente (fatia posterior), vai para a ElevenLabs **o texto que o
agente fala na ligação**. Ao confirmar um pedido, o agente repete o que a pessoa disse: nome,
endereço, telefone e horário. Nesta versão, só sai a chave, no teste e na leitura da lista de vozes.

## O que a ElevenLabs diz que faz com o texto

Lido em 17/11/2026, 15:50 UTC, e conferido de novo às 17:23 UTC do mesmo dia, na entrega:

1. **Zero Retention Mode**, <https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>
   (sha256 da versão `.md`: `0ca7448c2279cb985a0971253793499c53a8cb615adf3b01997bd6562f598087`, igual
   nas duas leituras):
   - a tabela "Default Retention" diz que, no Text to Speech, o texto enviado (*Text Input*) e o
     áudio gerado (*Audio Output*) ficam guardados por padrão (**Enabled**);
   - "Customers by default have history preservation enabled. All customers can use the API to
     delete generations at any time. This action will immediately remove the corresponding audio and
     text from our database; however, debugging and moderation logs may still retain data related to
     the generation.";
   - "Following data deletion, database items are retained in backups for up to 30 days.";
   - o modo sem retenção é **só do plano Enterprise**: "Enterprise customers can use Zero Retention
     Mode".
2. **Política de privacidade**, <https://elevenlabs.io/privacy-policy> ("Updated 9 October 2026";
   sha256 do HTML na primeira leitura: `c45b9f33cfe1406f47e867e4eb3864d55602ee228441851b2efac812c85d3880`;
   na segunda, o HTML mudou de bytes, `c2d6101a…`, mas o texto visível é o mesmo):
   - seção 6: "We generally keep your personal information for as long as necessary to provide you
     with our Services […] for example, for as long as you have an account with us";
   - "Wherever you are, your personal information will be transferred to the United States for
     storage."

Em resumo, fora do Enterprise:

- **Retenção:** o texto fica no histórico da conta até alguém apagar a geração ou a conta. A página
  não dá outro prazo.
- **Depois de apagar:** fica até 30 dias em cópia de segurança.
- **Registros de depuração e moderação:** podem guardar dados da geração, sem prazo declarado.
- **Armazenamento:** nos Estados Unidos (política de privacidade, atualizada em 9/10/2026).
- **Processamento:** a ElevenLabs não declara onde processa. O DeskVoice diz "não declarado"
  (`processingLocation: undeclared`) e não presume país.

O projeto não leu os Termos de Serviço, o DPA nem a página de segurança da ElevenLabs.

A decisão de oferecer a ElevenLabs mesmo sem prazo de retenção foi do Rafael, em 17/11/2026, com o
aviso dizendo o que as páginas dizem (DESA-103, opção A).

## Apagar o que foi enviado

O apagamento do DeskVoice (prazo de guarda, pedido de quem ligou) **não alcança a ElevenLabs**.
Para apagar o texto lá, apague as gerações no histórico da conta da ElevenLabs (pela tela dela ou
pela API). Ficam ainda a cópia de segurança de até 30 dias e os registros de depuração e moderação.
Remover a chave no DeskVoice só para os envios novos.
