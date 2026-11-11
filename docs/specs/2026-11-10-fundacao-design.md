# DeskVoice: desenho da fundação

> Data: 2026-11-10. Estado: aprovado pelo dono em conversa (itens marcados **[dono]**).
> O que está marcado **[construtor]** foi decidido por quem escreveu este documento e pode ser revisto.

## Intenção

DeskVoice é uma central telefônica open source operada por agentes de IA, instalada na VPS de
quem usa. A ligação não é o produto: é o começo de um trabalho. Um agente atende, executa
ferramentas durante a conversa, avisa ou consulta um humano, transfere quando precisa e deixa
tarefas rodando depois que a chamada termina.

Ele nasce como projeto irmão do DeskcommCRM e herda a fábrica que fez o Deskcomm crescer
(contribuição guiada por skills, CI, release por fragmentos, instalador), sem herdar os erros
medidos lá.

## Por que agora

O Deskcomm já tem telefonia com IA, mas como módulo: o agente de voz não devolve o resultado da
ligação ao resto do sistema, a conexão do tronco exige editar arquivo por SSH e a ligação não
entra no limite de gasto. O público pede exatamente o que falta. DeskVoice é o lugar onde a
telefonia vira sistema.

## Decisões do dono

1. **Fronteira [dono]:** DeskVoice é um sistema independente. O módulo de ligações do Deskcomm
   continua como está e, mais adiante, vira um conector fino para o DeskVoice.
2. **Motor [dono]:** Asterisk na borda de telefonia, com a ponte AudioSocket já provada no
   Deskcomm. Modelos de voz direta atrás de uma interface única, preferindo os que falam bem
   português do Brasil.
3. **Casa [dono]:** organização `DeskLabs-OpenSource` no GitHub, repositório `DeskVoice`.
4. **Banco [dono]:** Postgres dentro da VPS como padrão. Supabase fica como opção documentada.
5. **Ligações feitas pelo robô [dono]:** o recurso existe e vem desligado. O dono da instalação
   liga depois de declarar finalidade, e a partir daí valem teto diário, lista de não ligar,
   janela de horário e aviso de gravação.

## Objetivos da fundação

- Uma pessoa instala em uma VPS Ubuntu com um comando, sem editar variável de ambiente à mão.
- Uma ligação recebida é atendida por um agente configurado no painel.
- Durante a chamada o agente executa ferramentas, entre elas avisar um humano, pedir aprovação
  e transferir a ligação.
- Tudo o que acontece na chamada vira evento numa linha do tempo, com custo.
- Ao fim da chamada, tarefas continuam (resumo, aviso, webhook).
- Um contribuidor de primeira viagem consegue abrir um PR bom guiado pelas skills do repositório,
  e o CI diz de quem é a culpa quando fica vermelho.

## Fora do escopo desta fundação

- Site com guias e curso (repositório separado, depois).
- Ligação pelo WhatsApp (sem caminho estável para instalação própria).
- Construtor visual de fluxos.
- Pipeline STT + LLM + TTS (a interface de motor permite, o primeiro PR da comunidade pode trazer).
- Multiempresa na tela. O banco já nasce com `organization_id` em toda tabela; a tela opera uma.
- Gravação de áudio. A fundação guarda transcrição; gravar áudio pede decisão de retenção.

## Antiobjetivos

Seria um fracasso, mesmo funcionando, se:

- o agente ficasse mudo sem avisar ninguém na tela;
- alguma capacidade exigisse SSH para ligar;
- a instalação dissesse "pronto" com a ligação muda;
- o custo de uma chamada não aparecesse ou não respeitasse teto;
- a fundação facilitasse disparo em massa.

## Arquitetura

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

Regras de forma:

- **Um caminho de schema.** Instalar é aplicar todas as migrations em ordem. Não existe baseline
  separado. Nome de migration é carimbo de tempo, nunca número sequencial.
- **Um arquivo por peça.** Ferramenta, motor de voz, rotina e dicionário de tela moram cada um no
  próprio arquivo e são descobertos por pasta. Não existe lista central que todo PR edita.
- **Um ponto de escrita por entidade** e **uma camada de autorização** (`withOrg`), com teste de
  isolamento gerado para toda tabela.
- **Fila por notificação**, sem polling de intervalo curto.
- **Configuração de operador tem tela.** O `.env` só guarda o que o instalador gera.
- **Tudo tem log:** `call_events` é a linha do tempo da chamada e a fonte da tela.

## Peças e responsabilidades

| Peça | Responsabilidade |
|---|---|
| `packages/core` | Conexão com o banco, executor de migrations, `withOrg`, registro de eventos, fila, cifra de segredos, configuração |
| `packages/voice-engine` | Interface `VoiceEngine` e os motores `simulated`, `gemini-live`, `openai-realtime`; conversão de áudio |
| `packages/tools` | Interface `Tool`, descoberta por pasta, ferramentas da fundação |
| `apps/voice` | ARI, servidor AudioSocket, ciclo de vida da chamada, política de saída, medição de custo |
| `apps/routines` | Consumidor da fila: resumo pós-chamada, avisos, webhooks, expiração de aprovação |
| `apps/panel` | Painel e API: entrar, agentes, linha telefônica, chamadas ao vivo, linha do tempo, aprovações, ligações de saída, custo |
| `deploy/` | Compose, Caddy, modelos de configuração do Asterisk |
| `install/` | `install.sh`, `update.sh`, `healthcheck.sh`, `backup.sh`, `restore.sh` |
| `.agents/skills` | Skills embutidas; `.claude/skills` é espelho gerado |
| `.github/` | CI, acolhida, release, imagens, modelos de issue e PR |

## Contratos

Os contratos exatos (tabelas, interfaces, eventos, rotas, variáveis) estão no plano:
`docs/plans/2026-11-10-fundacao.md`, seção "Contratos compartilhados".

## Erros do Deskcomm que esta fundação fecha

| Erro medido | Regra aqui |
|---|---|
| Fila de CI entupida pelo teto da conta pessoal | Repositório nasce em organização; um run por PR, com cancelamento do anterior |
| PR bom vermelho por causa alheia | Check de PR só mede o diff; estado acumulado é check da `main`; teste sem relógio real, porta fixa ou fuso |
| Colisão de migration e de arquivo-índice | Carimbo de tempo; um arquivo por peça; fila de merge |
| Baseline e migrations divergentes | Um caminho de schema; teste de atualização a partir da última release |
| Atualizador nunca testado | O CI aplica as migrations novas sobre um banco da última versão com dados; `update.sh` tem testes com Docker simulado. Atualização real de ponta a ponta no CI fica para depois |
| Dependência do Supabase na nuvem | Postgres na VPS; fila por notificação |
| Isolamento entre empresas furado | `organization_id` desde o primeiro dia; camada única; teste gerado |
| Variável de ambiente manual para ligar recurso | Configuração pela tela; cerca que reprova variável sem padrão |
| Backup e restore que diziam "sucesso" sem conferir | `restore.sh` confere contagens; a lógica é testada no CI com Docker simulado e foi conferida à mão num Postgres real |
| Agente apagou o checkout principal | Doutrina: agente trabalha em worktree; comando destrutivo com caminho absoluto conferido |
| Dono como gargalo de decisão | `GOVERNANCE.md` com regras de produto; todo pedido de decisão traz o padrão que vale sem resposta |
| Segredo e dado pessoal no repositório | Varredura de segredo no CI e no hook desde o primeiro commit |
| Trava que sobrevive ao motivo | Toda cerca tem dono, motivo e data de revisão |
| Código de terceiros sem crédito | `CREDITS.md` desde o primeiro commit |

## Decisões do construtor

- **Idioma [construtor]:** identificadores de código em inglês; documentação em pt-BR com versão
  em inglês e espanhol; tela com dicionário pt-BR, en e es desde o início. A comunidade
  internacional do Deskcomm pede inglês de forma recorrente.
- **Monorepo pnpm [construtor]:** três processos e três pacotes. Cada pacote já tem dois
  consumidores no primeiro dia.
- **Autenticação própria [construtor]:** usuários e sessões no Postgres da VPS, senha com scrypt.
- **Identidade visual [construtor]:** mesma família do Deskcomm (calma, Atkinson Hyperlegible,
  IBM Plex Mono, ícones Phosphor), com cor de acento própria para a voz.
- **Licença [construtor]:** MIT, igual ao Deskcomm.
- **Sem telemetria [construtor].**

## O que fica para quem constrói

Nomes internos de função, organização de componentes da tela, textos de microcopy dentro do tom
"profissional calmo" e a escolha de bibliotecas pequenas, desde que cada escolha caiba nas regras
de forma acima.
