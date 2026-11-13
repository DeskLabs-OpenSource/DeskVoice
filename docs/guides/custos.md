# Custos

O DeskVoice é gratuito. Não existe versão paga, recurso travado nem taxa por chamada cobrada
pelo projeto. O que você paga é a sua própria infraestrutura, direto a cada fornecedor.

> **Tudo aqui é estimativa.** Preços de provedor mudam, variam por modelo e por contrato, e este
> guia não é atualizado a cada mudança. Antes de fechar um orçamento, confira a tabela de preços
> oficial de cada fornecedor.

## As três contas

| Conta | A quem você paga | Como é cobrada |
|---|---|---|
| VPS | À hospedagem | Valor fixo mensal |
| Telefonia | À operadora do tronco SIP | Depende do tronco: mensalidade do número, minutos ou pacote |
| IA de voz | Ao provedor do modelo (Google ou OpenAI) | Por uso: duração do áudio e tokens |

### VPS

Custo fixo. A recomendação conveniente é a
[HostGator](https://www.hostgator.com.br/52708-141-3-52.html), parceira de infraestrutura do
projeto (link de parceria). Qualquer VPS Ubuntu com Docker funciona da mesma forma.

O que consome a VPS é o número de chamadas ao mesmo tempo, e não o total do mês. Uma empresa
que recebe muitas ligações ao longo do dia, uma de cada vez, usa pouco.

### Telefonia

É a conta que mais varia, porque depende inteiramente do tronco. Ao contratar, pergunte:

- Receber ligação é cobrado por minuto, ou está incluído na mensalidade do número?
- Quanto custa o minuto de saída para fixo e para celular? Isso importa para as
  **transferências**: quando o agente passa a ligação para o celular de alguém, a operadora
  cobra uma chamada de saída.
- Quantas chamadas simultâneas o plano permite?
- A autenticação é por registro ou por IP? As duas funcionam.

O projeto não recomenda operadora e não tem parceria com nenhuma.

### IA de voz

É a conta que cresce com o uso. Nos motores de voz direta, em que o modelo ouve e fala sem
etapas intermediárias, a estimativa vai **de uns poucos centavos a uns dez centavos de dólar por
minuto de conversa**, conforme o motor e o modelo (veja o [cenário](#um-cenário-datado)). A
cobrança é em dólar, e o valor em reais acompanha o câmbio.

O que faz o minuto custar mais:

- **O modelo.** Modelos maiores custam mais por minuto.
- **Instruções longas.** O texto de instruções do agente é enviado ao modelo e conta como uso.
- **Muitas ferramentas.** A descrição de cada ferramenta também conta.
- **Conversa longa.** Em geral, o histórico da chamada pesa mais a cada minuto.

## Como estimar a sua conta

Não use um número pronto. Faça a conta com os seus dados:

```
custo mensal de IA ≈ ligações por mês × duração média em minutos × custo por minuto do modelo
```

Depois some a VPS e a telefonia.

Para descobrir os dois números que você não tem:

1. **Duração média.** Peça à operadora o relatório do mês anterior, ou cronometre algumas
   ligações típicas. Atendimentos de rotina costumam ser curtos.
2. **Custo por minuto real.** Instale, faça dez ligações de teste com o agente configurado como
   vai ficar e leia o custo na linha do tempo de cada uma. O número medido na sua instalação
   vale mais do que qualquer tabela.

## Um cenário datado

Para dar ordem de grandeza a quem vai fechar um cliente. **É estimativa**, com preços consultados
em 12/11/2026 nas páginas oficiais. Preço muda: confira na fonte antes de usar. Na sua
instalação, o painel mede o custo real de cada chamada, e a fatura do provedor é a verdade.

**O caso:** 300 ligações recebidas por mês, de 3 minutos em média, ou 900 minutos de conversa,
com um motor só.

| Conta | Valor por mês | Como se chegou a ele |
|---|---|---|
| VPS | Até R$ 173,32 | Plano VPS NVMe 8 da [HostGator](https://www.hostgator.com.br/52708-141-3-52.html) (link de parceria): 4 vCPU, 8 GB e 200 GB, o tamanho em que a instalação foi provada. É o preço cheio do ciclo mensal, lido nos dados da página aberta pelo link. Contratos mais longos e campanhas saem mais baratos, mas o valor da tela de compra **não foi conferido**. Qualquer VPS do mesmo tamanho serve |
| IA, Gemini Live | Até cerca de US$ 21 | 900 min × US$ 0,023. A página de preços do Google dá o áudio do `gemini-3.8-live` também por minuto: US$ 0,005 na entrada e US$ 0,018 na saída. A soma é o teto de um minuto em que o modelo ouve e fala o tempo todo. As instruções do agente entram à parte, como texto (US$ 0,75 por milhão de tokens; o motor do DeskVoice as cobra como áudio, o que superestima um pouco). O projeto ainda não mediu uma ligação do Gemini contra a fatura |
| IA, OpenAI Realtime | Cerca de US$ 95 | 900 min × cerca de US$ 0,11. É a única medida contra fatura que o projeto tem: uma ligação real de 1:53 custou cerca de US$ 0,20 (#94). Uma ligação só, e o minuto encarece com a duração, porque cada resposta reconta a conversa inteira como entrada |
| Telefonia | **Não conferido** | Depende do tronco. O projeto não recomenda operadora; peça a proposta com as perguntas de [Telefonia](#telefonia) |

O minuto da OpenAI custa mais porque o áudio é cobrado por token: segundo a OpenAI, o áudio de
quem fala com o modelo vira 1 token a cada 100 ms, e o do modelo, 1 token a cada 50 ms. Pelos
preços do `gpt-realtime-2.1` (por milhão de tokens: áudio US$ 32 na entrada e US$ 64 na saída;
texto US$ 4 e US$ 24; entrada em cache US$ 0,40), um minuto do modelo falando custa US$ 0,077
só no áudio de saída. O motor do DeskVoice separa áudio, texto e cache ao calcular, com esses
preços.

Fontes, consultadas em 12/11/2026:

- Google: <https://ai.google.dev/gemini-api/docs/pricing>, que redireciona para a página de preços do AI Studio.
- OpenAI, preços: <https://developers.openai.com/api/docs/pricing>.
- OpenAI, tokens por tempo de áudio: <https://developers.openai.com/api/docs/guides/voice-latency-cost>.
- HostGator: a página aberta pelo link de parceria acima.
- A ligação medida da OpenAI: o PR #94, também no [`CHANGELOG.md`](../../CHANGELOG.md).

Os mesmos preços de IA estão no código, com a data e a fonte, em
`packages/voice-engine/src/engines/`. Quando o provedor mudar o preço, mude lá e aqui.

## Limites gratuitos

| Conta | Limite gratuito, em 12/11/2026 |
|---|---|
| DeskVoice | É gratuito. O motor simulado (`pnpm demo`, chamada simulada no painel) não chama provedor e não custa nada |
| Gemini Live (Google) | Existe nível gratuito para os modelos Live. A mesma página diz que, nele, o conteúdo é usado para melhorar os produtos do Google, e no pago não. Para conversa de quem liga, que é dado pessoal, use só o pago. Os limites de uso do gratuito **não foram conferidos** |
| OpenAI Realtime | A página de preços não fala de nível gratuito nem de crédito para o Realtime |
| VPS (HostGator) | A página não oferece plano gratuito. Ela fala em 30 dias para reembolso; as condições não foram conferidas |
| Telefonia | **Não conferido.** Depende da operadora |

## Como o DeskVoice mede

- **Cada chamada tem custo.** O motor informa o uso, o sistema converte em valor com a tabela de
  preço daquele motor, e o resultado aparece na linha do tempo da chamada.
- **O painel soma por período.** A tela de custos mostra o total entre duas datas.
- **O custo mostrado é uma estimativa** calculada a partir do uso informado. A fatura do
  provedor é a verdade. Se a diferença entre as duas for grande, isso é um defeito: abra uma
  issue, com os dois números.
- **O painel não vê a conta da operadora nem a da VPS.** Ele mede a IA.

## Como o DeskVoice limita

Cada agente tem dois limites, ajustáveis pela tela:

| Limite | O que faz |
|---|---|
| Duração máxima da chamada | Ao atingir, a chamada é encerrada |
| Teto de custo por chamada | Ao atingir, a chamada é encerrada, e a linha do tempo registra o motivo |

Eles existem para o caso ruim: uma ligação que fica aberta, alguém que resolve conversar uma
hora com o agente, um defeito. Ajuste os dois para o tamanho normal do seu atendimento, com
folga.

Esses dois limites valem por chamada. Para o gasto somado, a organização tem um limite de
**ligações recebidas ao mesmo tempo**, em Configurações: de 1 a 50, e 5 de fábrica. Acima dele,
quem liga recebe sinal de ocupado antes de qualquer gasto com IA, e a recusa aparece em Chamadas
com o motivo. O pior caso de gasto simultâneo passa a ser o teto por chamada vezes esse limite.
Chamadas pelo navegador têm um limite próprio, de 3 por organização, e as ligações feitas pelo
agente têm o teto diário de Ligações de saída.

Além disso, defina um limite de gasto **na conta do provedor de IA**. É a proteção que não
depende do DeskVoice.

## O que barateia

- Instruções objetivas. Texto que não muda o comportamento do agente só custa.
- Dar ao agente só as ferramentas que ele usa.
- Transferir cedo o que o agente não resolve. Insistir custa minutos e paciência.
- Escolher o modelo pela medida. Teste o mais barato primeiro, com ligações reais.

## O que este guia não diz

- **O custo de IA em reais.** Depende de câmbio, modelo e contrato, e envelhece em semanas. O
  cenário acima fica em dólar, como a fatura.
- **Um preço de telefonia.** Não há operadora recomendada para dar a referência.
- **Qual modelo é melhor para português do Brasil.** Depende de medição. Uma bancada de latência
  e qualidade é uma das frentes abertas no [`ROADMAP.md`](../../ROADMAP.md).

Vai cobrar de clientes pela implantação? Veja
[ganhar dinheiro implementando](ganhar-dinheiro-implementando.md).
