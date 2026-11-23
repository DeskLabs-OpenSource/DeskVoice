# Fontes das amostras de voz

De onde vêm as amostras do botão "Ouvir" (`apps/panel/public/voice-samples/`), e por que o projeto
pode redistribuí-las. Escrito para a fatia 1b da DESA-397; os MP3 entram na 1c.

## Os termos de uso, lidos em 23/11/2026

**Nenhum dos dois proíbe publicar o áudio gerado. Os dois seguem no script.** A OpenAI passa ao
cliente a posse do que sai do modelo. O Google diz que não reivindica a posse e que o uso fica por
conta de quem gerou, mas o texto lido não dá permissão de redistribuir: só não proíbe. E os termos
do Google remetem aos Google APIs Terms of Service, que não foram lidos (veja "Não medido").

### OpenAI (API: `openai-realtime`)

O uso pela API segue os **Business Terms**, e não os Terms of Use, que são para as pessoas físicas.
Os Terms of Use dizem isso: "Our Business Terms govern use of ChatGPT Enterprise, our APIs, and our
other services" (<https://openai.com/policies/terms-of-use/>, "Effective: January 1, 2026").

- Endereço: <https://openai.com/policies/business-terms/> ("Effective: January 1, 2026",
  "Updated: December 1, 2025"), lido em 23/11/2026.
- Seção 4.1, a posse: "Customer: (a) retains all ownership rights in Input; and (b) owns all
  Output." e "OpenAI hereby assigns to Customer all OpenAI's right, title, and interest, if any, in
  and to Output." A posse vale "to the extent permitted by applicable law".
- Seção 4.3: "Customer is solely responsible for all use of the Outputs".
- O que a seção 3.3 proíbe e importa aqui: usar o Output para desenvolver modelos que concorram com
  a OpenAI (3.3(e)), e usar o serviço contra a lei ou as políticas da OpenAI (3.3(a)). Tocar uma
  amostra no painel não é nenhum dos dois.
- **O aviso de voz sintética.** O guia de voz da OpenAI pede "a clear disclosure to end users that
  the TTS voice they are hearing is AI-generated and not a human voice"
  (<https://developers.openai.com/api/docs/guides/text-to-speech>, lido em 23/11/2026). A página é a
  do TTS, e não a da Realtime; ela vale aqui por cautela. Na tela, a amostra fica no campo "Voz" do
  agente, debaixo de "As vozes do provedor OpenAI, pelo motor OpenAI Realtime." Se isso basta como
  aviso é decisão do Rafael (veja "Não medido").

### Google (API do Gemini: `gemini-live`)

O endereço antigo (<https://ai.google.dev/gemini-api/terms>) redireciona para
<https://aistudio.google.com/docs/terms> ("Effective March 23, 2026"), lido em 23/11/2026.

- "Use of Generated Content": "Google won't claim ownership over that content." e "You acknowledge
  that Google may generate the same or similar content for others and that we reserve all rights to
  do so."
- A mesma seção, a frase inteira: "As required by the API Terms, you'll comply with applicable law
  in using generated content, which may require the provision of attribution to your users when
  returned as part of an API call." A obrigação vem dos "API Terms", e a atribuição pode ser exigida
  quando o conteúdo volta numa chamada da API.
- Os "API Terms" são os **Google APIs Terms of Service** (<https://developers.google.com/terms>), que
  a página manda aceitar ("you must accept (1) the Google APIs Terms of Service (the "API Terms")").
  **Não foram lidos.**
- A mesma seção: "You're responsible for your use of generated content, and for the use of that
  content by anyone you share it with."
- "Disclaimers": "Use discretion before relying on, publishing, or otherwise using content provided
  by the Services." O texto fala em publicar, e não proíbe.
- O que tem regra mais dura são os resultados da busca do Google ("Grounding with Google Search"),
  que a amostra não usa.
- O texto não tem regra própria para áudio ou voz.

## Como cada amostra é gerada

- **Modelo:** o padrão do motor, o mesmo que a ligação abre: `gpt-realtime-2.1` (`openai-realtime`)
  e `gemini-3.8-live` (`gemini-live`). O script não passa `model`. `amostras.test.ts` reprova se o
  nome do manifesto deixar de ser o `DEFAULT_MODEL` do motor. **Não é o modelo de TTS** de nenhum
  dos dois provedores.
- **Caminho:** uma sessão do próprio motor de `packages/voice-engine`, com a voz escolhida, sem
  ferramentas, e o pedido de fala literal que a ligação usa (`say`: "Say exactly the following to
  the caller, in <idioma>, without adding anything: …"). Instruções da sessão: as de `INSTRUCOES` em
  `amostras.ts`.
- **Som:** o motor entrega a fala em PCM16 mono a 8 kHz, como na linha telefônica. O MP3 sai mono, a
  16 kHz e 32 kbit/s (`ffmpeg` com `libmp3lame`). Subir a taxa não acrescenta nada: a amostra soa
  como a ligação, e não como o áudio cheio do provedor.
- **Frases** (`FRASES` em `amostras.ts`), com o `language` da sessão entre parênteses:
  - pt-BR (`pt-BR`): "Olá, aqui é a assistente da sua empresa. Como posso ajudar?"
  - en (`en-US`): "Hi, this is your company's assistant. How can I help?"
  - es (`es-MX`): "Hola, soy la asistente de tu empresa. ¿En qué puedo ayudarte?"
- **Conferência:** o texto que o motor de fato falou (a transcrição da fala do agente que o provedor
  devolve) é comparado com a frase, sem contar maiúscula, acento e pontuação. Se foge, o arquivo vai
  como `<voz>.<idioma>.divergente.mp3` e não entra no `sample`.
- **Comando:**

  ```bash
  pnpm exec tsx scripts/amostras-de-voz/gerar.ts --teto-usd 2
  ```

  Data, modelo, frase, texto falado e custo de cada arquivo ficam no `manifesto.json`, ao lado dos
  MP3.

## Não medido

- Os termos foram lidos em inglês, nas páginas públicas, em 23/11/2026. Nenhum advogado leu.
- Os Google APIs Terms of Service (<https://developers.google.com/terms>), a que os termos do Gemini
  remetem, não foram lidos: o que eles dizem sobre publicar e sobre atribuição está em aberto.
- Se a atribuição que o Google diz poder exigir vale para uma amostra tocada no painel.
- Se a linha "As vozes do provedor…" basta como o aviso de voz sintética que o guia da OpenAI pede.
- Se a conta da OpenAI ou do Google do Rafael tem algum contrato próprio que mude o que está acima.
- Nenhum áudio foi gerado ainda: o que está acima diz como ele será gerado, e não o que saiu.
