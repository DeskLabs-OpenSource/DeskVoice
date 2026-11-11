# Arquitetura do DeskVoice

> Visão de uma página. A profundidade está no
> [desenho da fundação](docs/specs/2026-11-10-fundacao-design.md) e nos contratos do
> [plano de implementação](docs/plans/2026-11-10-fundacao.md).

## O desenho

```
        tronco SIP (operadora)
               │ SIP + RTP (UDP)
        ┌──────▼──────┐
        │  Asterisk   │  borda de telefonia; nunca fala com a internet por HTTP
        └──┬───────┬──┘
   ARI (WS)│       │AudioSocket (TCP, PCM16 8 kHz)
        ┌──▼───────▼──┐        ┌──────────────────┐
        │  apps/voice │◄──────►│ motor de voz     │ Gemini Live / OpenAI Realtime / simulado
        │             │        └──────────────────┘
        │  ferramentas│──► avisar humano, pedir aprovação, transferir, webhook, WhatsApp
        └──────┬──────┘
               │ eventos + tarefas
        ┌──────▼──────┐   LISTEN/NOTIFY   ┌──────────────┐
        │  Postgres   │◄─────────────────►│ apps/routines │ tarefas pós-chamada
        └──────▲──────┘                   └──────────────┘
               │
        ┌──────┴──────┐
        │  apps/panel │  Next.js: painel + API; publicado pelo Caddy
        └─────────────┘
```

São três processos Node sobre três pacotes, um Asterisk na borda e um Postgres na mesma VPS.

## Peças

| Peça | Responsabilidade |
|---|---|
| `packages/core` | Conexão com o banco, executor de migrations, `withOrg`, registro de eventos, fila, cifra de segredos, configuração |
| `packages/voice-engine` | Interface `VoiceEngine`, os motores `simulated`, `gemini-live` e `openai-realtime`, conversão de áudio |
| `packages/tools` | Interface `Tool`, descoberta por pasta, ferramentas da fundação |
| `apps/voice` | Controle do Asterisk (ARI), servidor AudioSocket, ciclo de vida da chamada, política de saída, medição de custo |
| `apps/routines` | Consumidor da fila: resumo pós-chamada, entrega de avisos, tarefas de acompanhamento, expiração de aprovação |
| `apps/panel` | Painel e API: entrar, agentes, linha telefônica, chamadas ao vivo, linha do tempo, aprovações, ligações de saída, custo |
| `deploy/` | Compose, Caddy, modelos de configuração do Asterisk |
| `install/` | Instalação, atualização, checagem de saúde, backup e restauração. Inclui o agente de atualização (`agent.sh`), o único processo do DeskVoice que roda fora de contêiner: passa a cada minuto, anuncia a versão ao painel e lê um sim ou um não. O painel pede a atualização; quem executa é ele ([registro 0010](docs/decisions/0010-atualizar-pela-tela.md)) |

## O caminho de uma ligação

Do toque ao pós-chamada. Entre parênteses, o evento que cada passo grava em `call_events`.

1. **Toque.** A operadora entrega a chamada ao Asterisk pelo tronco SIP. A sinalização chega por
   SIP e o áudio por RTP, em UDP.
2. **Entrada.** O Asterisk entrega o controle da chamada a `apps/voice` pela interface ARI. O
   número chamado aponta para um agente. Nasce o registro da chamada (`call_started`).
3. **Recusa com motivo.** Se o agente não tem motor de voz configurado ou a chave é inválida, a
   chamada não fica muda: é recusada com o motivo `engine_not_configured` e o painel recebe um
   aviso (`call_refused`). Antes disso, na entrada, a chamada que passa do limite de ligações
   recebidas ao mesmo tempo da organização recebe sinal de ocupado, com o motivo
   `inbound_limit_reached`.
4. **Atendimento.** O áudio passa a trafegar entre o Asterisk e `apps/voice` por AudioSocket: uma
   conexão TCP com PCM16 mono a 8 kHz, em quadros de 20 ms (`call_answered`).
5. **Sessão com o motor.** `apps/voice` abre uma sessão no motor de voz do agente, com as
   instruções, a saudação e a lista de ferramentas. Quem ligou ouve o aviso de gravação
   (`recording_notice`) e a saudação.
6. **Conversa.** O áudio de quem ligou segue para o motor, e a fala do agente volta. Cada motor
   converte o áudio para o formato que o provedor pede. Cada turno entra na linha do tempo
   (`transcript_user`, `transcript_agent`). Se a pessoa fala por cima, o áudio pendente é
   descartado.
7. **Ferramenta.** Quando o modelo pede uma ferramenta, `apps/voice` valida a entrada, executa e
   devolve o resultado ao modelo, com o que ele deve dizer a quem está na linha (`tool_called`,
   `tool_result`).
8. **Humano no meio.** `notify_human` avisa a equipe pelo painel e, quando há conector e a pessoa
   cadastrou o próprio WhatsApp, também por WhatsApp (`human_notified`). `request_approval` cria um pedido com prazo e resposta padrão, e a chamada
   espera (`approval_requested`). A decisão tomada na tela libera a chamada
   (`approval_decided`). Sem decisão no prazo, o pedido expira e vale a resposta padrão.
9. **Transferência.** `transfer_to_human` passa a ligação para uma pessoa (`transfer_started`,
   `transfer_completed`).
10. **Limites.** O motor informa o uso, o medidor converte em custo e grava no livro de uso. Ao
    atingir a duração máxima ou o teto de custo do agente, a chamada é encerrada
    (`cost_ceiling_reached`).
11. **Falha do motor.** Se a sessão com o provedor cai no meio da conversa, quem ligou ouve um
    sinal de aviso (o motor caído não consegue falar), e a chamada é transferida ou encerrada
    (`engine_failed`).
12. **Fim.** A chamada fecha com estado e motivo (`call_ended`), e o resumo pós-chamada entra na
    fila (`task_queued`).
13. **Pós-chamada.** O Postgres notifica `apps/routines`, que reivindica a tarefa, executa, tenta
    de novo se falhar e registra o desfecho (`task_finished`). Dois processos nunca executam a
    mesma tarefa.
14. **Tela.** O painel lê os mesmos eventos. A linha do tempo de uma chamada é a tabela
    `call_events`, e as chamadas ao vivo chegam por um fluxo de eventos do servidor.

## Regras de forma

Seis regras decidem onde cada coisa mora. Cada uma tem a sua doutrina.

| Regra | Em uma frase | Doutrina |
|---|---|---|
| Um caminho de schema | Instalar é aplicar todas as migrations em ordem. Não há baseline separado | [`um-caminho-de-schema.md`](docs/doctrine/um-caminho-de-schema.md) |
| Um arquivo por peça | Ferramenta, motor, rotina e dicionário de tela são descobertos por pasta. Não há lista central | [`um-arquivo-por-peca.md`](docs/doctrine/um-arquivo-por-peca.md) |
| Uma camada de autorização | Todo dado de produto passa por `withOrg`, com teste de isolamento gerado para toda tabela | [`isolamento.md`](docs/doctrine/isolamento.md) |
| Fila por notificação | O banco avisa quando há tarefa. Não há polling de intervalo curto | [`sistema-vivo.md`](docs/doctrine/sistema-vivo.md) |
| Configuração tem tela | O `.env` só guarda o que o instalador gera | [`cercas.md`](docs/doctrine/cercas.md) |
| Tudo tem log | `call_events` é a linha do tempo da chamada e a fonte da tela | [`sistema-vivo.md`](docs/doctrine/sistema-vivo.md) |

## O que fica exposto na VPS

| Porta | Para quê | Publicada |
|---|---|---|
| 80 e 443 | Painel e API, atrás do Caddy | Sim |
| 5060 | Sinalização SIP com a operadora | Sim |
| Faixa de RTP (UDP) | Áudio da chamada | Sim |
| Controle do Asterisk (ARI) | `apps/voice` comanda as chamadas | **Nunca.** Só na rede interna do Docker |
| AudioSocket | Áudio entre o Asterisk e `apps/voice` | Não. Só na rede interna |
| Postgres | Banco | Não. Só na rede interna |
| Rota do agente de atualização (`/api/v1/system/agent`) | O agente do servidor anuncia a versão e lê o pedido | **Nunca.** O agente fala de dentro do contêiner do painel; o Caddy responde 404 nesse caminho, e o painel recusa pedido que veio por proxy |

Segredos do operador, como a senha do tronco e a chave de IA, ficam cifrados em repouso com
AES-256-GCM.

## Onde olhar a fundo

- [`docs/specs/2026-11-10-fundacao-design.md`](docs/specs/2026-11-10-fundacao-design.md): intenção, objetivos, antiobjetivos e os erros do Deskcomm que a fundação fecha.
- [`docs/plans/2026-11-10-fundacao.md`](docs/plans/2026-11-10-fundacao.md): contratos exatos de tabelas, interfaces, eventos, rotas e variáveis.
- [`docs/decisions/`](docs/decisions/0001-fronteira-com-o-deskcomm.md): por que cada escolha grande foi feita e o que foi descartado.
- [`docs/doctrine/`](docs/doctrine/sistema-vivo.md): as leis do projeto.
- [`AGENTS.md`](AGENTS.md): convenções para quem escreve código, pessoa ou assistente.
- [`docs/guides/adicionar-uma-ferramenta.md`](docs/guides/adicionar-uma-ferramenta.md) e [`docs/guides/adicionar-um-motor-de-voz.md`](docs/guides/adicionar-um-motor-de-voz.md): os dois pontos de extensão, na prática.
