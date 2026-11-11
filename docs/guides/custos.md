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
etapas intermediárias, a estimativa fica **na casa de alguns centavos de dólar por minuto de
conversa**, conforme o modelo escolhido. A cobrança é em dólar, e o valor em reais acompanha o
câmbio.

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

- **Valores em reais.** Dependem de câmbio, modelo e contrato, e envelhecem em semanas.
- **Qual modelo é melhor para português do Brasil.** Depende de medição. Uma bancada de latência
  e qualidade é uma das frentes abertas no [`ROADMAP.md`](../../ROADMAP.md).

Vai cobrar de clientes pela implantação? Veja
[ganhar dinheiro implementando](ganhar-dinheiro-implementando.md).
