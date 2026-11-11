# Roadmap do DeskVoice

Este documento diz para onde o projeto vai e onde a comunidade pode entrar. **Não há datas.** A
ordem das faixas é de prioridade, não de calendário. O que já existe está na seção "O que ele
faz hoje" do [`README.md`](README.md).

## Horizonte

### Agora: firmar a fundação

O trabalho em curso é fazer o que já existe aguentar o mundo real.

- Quilometragem dos motores Gemini Live e OpenAI Realtime em troncos e operadoras de verdade.
- Instalação testada em mais provedores de VPS e em mais combinações de rede (NAT, firewall).
- Mensagens de erro do instalador e da checagem de saúde que digam o que fazer, e não só o que
  falhou.
- Guias com telas reais, à medida que as telas estabilizam.
- **A primeira ligação real.** Nada foi provado ainda com operadora de verdade: entrada por tronco
  SIP, áudio ouvido, transferência atendida por uma pessoa. Quem fizer e relatar numa issue abre
  o caminho para todos.
- Dívidas conhecidas da fundação, listadas em [`SECURITY.md`](SECURITY.md) ("Limites conhecidos"):
  coluna de "pega em" na fila de tarefas, mensagem gravada para motor de voz caído, isolamento
  que resista a injeção de SQL, limite de login que sobreviva a reinício.
- Aviso de gravação antes da saudação (hoje sai logo depois).

### A seguir: o agente faz mais, e o humano enxerga mais

- Motor de voz em pipeline (transcrição, modelo de texto e síntese), como alternativa aos
  motores de voz direta.
- Ferramentas novas: agenda, CRM, pagamento.
- Conector com o DeskcommCRM.
- Transferência assistida, em que o agente apresenta o caso antes de passar a ligação.
- Painel de supervisão ao vivo.
- Filas e horário de atendimento.

### Depois

- Gravação de áudio com retenção configurável.
- URA por voz.
- Várias empresas operadas na mesma tela. O banco já nasce pronto para isso.
- Site com guias e curso, em repositório separado.

### Fora do horizonte por enquanto

- **Ligação pelo WhatsApp.** Não há caminho estável para instalação própria.
- **Construtor visual de fluxos.** O agente é configurado por instruções e ferramentas.
- **Qualquer coisa que facilite disparo em massa.** Não é adiamento. É regra de produto, escrita
  em [`GOVERNANCE.md`](GOVERNANCE.md).

## Frentes abertas para a comunidade

Cada frente tem um tamanho, um porquê e um ponto de entrada no código. Antes de começar, comente
"pego esta" na issue correspondente ou abra uma, como descrito em
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Tamanhos: **P** cabe em um PR pequeno. **M** pede alguns PRs ou um PR com teste de contrato.
**G** pede uma conversa de desenho antes do primeiro PR.

| Frente | Tam. | Por quê | Ponto de entrada |
|---|---|---|---|
| Motor de voz em pipeline (STT + LLM + TTS) | G | Permite escolher voz, modelo e custo peça por peça, e usar provedores que não têm voz direta | Interface `VoiceEngine` em `packages/voice-engine`. Um arquivo novo em `packages/voice-engine/src/engines/` |
| Novos motores de voz direta | M | Mais opções de preço e de qualidade em português do Brasil | Interface `VoiceEngine`. Guia: [adicionar um motor de voz](docs/guides/adicionar-um-motor-de-voz.md) |
| Ferramenta de agenda | M | Marcar e remarcar é o pedido mais comum por telefone | Interface `Tool` em `packages/tools`. Um arquivo novo em `packages/tools/src/tools/` |
| Ferramenta de CRM | M | Identificar quem ligou e registrar o que foi combinado | Interface `Tool`. Guia: [adicionar uma ferramenta](docs/guides/adicionar-uma-ferramenta.md) |
| Ferramenta de pagamento | M | Enviar um link de cobrança enquanto a pessoa está na linha | Interface `Tool`, com `request_approval` quando houver valor envolvido |
| Conector com o DeskcommCRM | G | Ligação e CRM conversando para quem usa os dois | Ferramenta `send_whatsapp` e a configuração `whatsapp.connector` em `packages/tools`. Contexto na [decisão 0001](docs/decisions/0001-fronteira-com-o-deskcomm.md) |
| Gravação com retenção configurável | G | Auditoria e treinamento. Pede decisão sobre por quanto tempo guardar e quem pode ouvir | Servidor AudioSocket em `apps/voice`. Começa por um pedido de decisão, no formato do [`GOVERNANCE.md`](GOVERNANCE.md) |
| Filas e horário de atendimento | M | Fora do horário e com todos ocupados são os dois momentos em que mais se perde ligação | Entrada de chamadas em `apps/voice`. Telas de agente e de linha em `apps/panel` |
| URA por voz | M | Encaminhar para o agente certo antes de a conversa começar | Entrada de chamadas em `apps/voice`. O protocolo AudioSocket já entrega os dígitos teclados |
| Transferência assistida | M | Quem recebe a ligação já sabe do que se trata | Ferramenta `transfer_to_human` em `packages/tools` e a parte de telefonia do contexto da ferramenta |
| Painel de supervisão ao vivo | M | Ver as chamadas em andamento e intervir | `apps/panel`, sobre o fluxo de eventos da API |
| Imagens ARM | P | VPS ARM costuma custar menos | Construção das imagens em `.github/` e os arquivos de `deploy/` |
| Instalação atrás de Traefik | M | Muitas VPS já têm um proxy ocupando as portas 80 e 443 | `install/` e `deploy/` |
| Ferramentas carregadas de fora do repositório | G | Ferramenta de nicho não entra no núcleo, e hoje só existe mantendo um fork | Descoberta por pasta em `packages/tools`. Pede desenho antes |
| Traduções | P | A tela nasce em português, inglês e espanhol, e os documentos ainda não acompanham tudo | Dicionários em `apps/panel/src/i18n/` e os documentos da raiz |
| Bancada de latência e qualidade em pt-BR | M | Escolher motor por medida, e não por impressão | `packages/voice-engine`, com o motor simulado como referência de roteiro |
| Site com guias | G | Quem não programa precisa de um lugar para aprender | Começa pelos textos em `docs/guides/`. O site vai para um repositório separado |

## Como uma frente entra aqui

Uma ideia vira frente quando tem um porquê ligado a quem usa, um ponto de entrada que não exige
reescrever outra peça e cabe nas regras de produto do [`GOVERNANCE.md`](GOVERNANCE.md). Proponha
em uma issue ou nas
[discussões](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions).
