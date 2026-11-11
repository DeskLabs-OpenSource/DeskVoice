# 0001: Fronteira com o DeskcommCRM

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** dono do projeto

## Contexto

O DeskcommCRM já tem telefonia com IA, como módulo. A meta pública das 500 estrelas foi
cumprida lá. O módulo funciona, e três limites dele foram medidos:

- o agente de voz não devolve o resultado da ligação ao resto do sistema;
- conectar o tronco exige editar arquivo por SSH;
- a ligação não entra no limite de gasto.

O público do Deskcomm pede exatamente o que falta. A pergunta era onde construir: dentro do
Deskcomm, ou fora.

## Decisão

O DeskVoice é um **sistema independente**, com repositório, instalação e banco próprios, em que
a telefonia é o centro.

O módulo de ligações do DeskcommCRM **continua como está**. Mais adiante, ele vira um **conector
fino** para o DeskVoice.

Nenhum dos dois projetos depende do outro para funcionar.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Evoluir o módulo dentro do DeskcommCRM | A telefonia tem borda própria (Asterisk, portas de áudio, NAT), ciclo de vida em tempo real e risco regulatório próprio. Dentro de um CRM, ela continuaria sendo uma função de outro produto, e cada limite acima exigiria mexer no núcleo do CRM. Quem só quer telefonia teria de instalar um CRM inteiro |
| Extrair o módulo e remover a telefonia do Deskcomm | Quebra quem já usa o módulo. Quem instalou não pode perder capacidade por decisão de arquitetura |
| Um fork do DeskcommCRM voltado a voz | Herdaria os erros medidos lá junto com o código: baseline separado, dependência de banco na nuvem, arquivos-índice. A fundação existe para não herdá-los |

## Consequências

**Boas:**

- A telefonia pode ter as próprias regras de forma desde o primeiro dia.
- Quem não usa o Deskcomm pode usar o DeskVoice, e o contrário.
- O risco de ligações de saída fica contido num sistema desenhado para ele.

**Custos:**

- Dois projetos para manter, com fábricas parecidas.
- Quem usa os dois, por enquanto, não tem a ligação e o CRM integrados. O caminho disponível
  hoje é a ferramenta de WhatsApp por conector e o webhook.
- O conector com o DeskcommCRM é trabalho futuro, sem data. Está no [`ROADMAP.md`](../../ROADMAP.md).

**O que foi trazido de lá:** a ponte AudioSocket e as lições de NAT e RTP, com crédito em
[`CREDITS.md`](../../CREDITS.md).
