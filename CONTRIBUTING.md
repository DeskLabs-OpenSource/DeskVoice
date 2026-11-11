# Contribuindo com o DeskVoice

Português · [English](CONTRIBUTING.en.md)

Este guia existe para que o seu primeiro PR dê certo. Se algo aqui estiver errado ou faltando,
isso é um bug do projeto: abra uma issue.

## Antes de começar

1. **Abra o repositório no seu assistente de código** (Claude Code, Codex, Cursor, Antigravity).
   A skill `deskvoice-contribuir`, em `.agents/skills/`, mede antes do PR o que a revisão mede
   depois, e arma os hooks de git.
2. Leia o [`AGENTS.md`](AGENTS.md). São as convenções, para pessoa e para assistente.
3. Leia o [`ARCHITECTURE.md`](ARCHITECTURE.md). É uma página.
4. Veja o sistema funcionando: `pnpm install && pnpm demo` roda uma chamada inteira sem chave
   de IA e sem operadora.

Procurando por onde começar? O [`ROADMAP.md`](ROADMAP.md) lista as frentes abertas, cada uma com
tamanho e ponto de entrada no código.

## Ramos

- A `main` é protegida. Ninguém envia direto para ela, nem mantenedor.
- Todo trabalho chega por PR, a partir de um fork ou de um ramo `feat/<assunto>` ou
  `fix/<assunto>`.
- **Nunca abra PR a partir da `main` do seu fork.** Crie um ramo com nome, a partir da `main`
  deste repositório, só com a sua mudança dentro.
- Existe um único caminho de merge: a fila de merge. Detalhes em
  [`GOVERNANCE.md`](GOVERNANCE.md).

## Commits

Conventional Commits, em português do Brasil. Assunto no imperativo, com até 72 caracteres.

```
feat(tools): adiciona ferramenta de consulta de agenda
fix(voice): encerra a chamada quando o motor fecha a sessão
docs(guides): corrige o passo do tronco na primeira ligação
```

## O que o CI reprova, e o que ele não vê

A lista está dividida em duas de propósito. Uma parte a máquina cobra. A outra só uma pessoa
percebe.

### O que o CI reprova

Rode antes de abrir o PR e não terá surpresa:

```bash
pnpm verify      # lint, tipos, cercas e testes de unidade
pnpm test:db     # só se tocou em banco; pede Docker
```

As cercas (`pnpm fences`) são o que mais reprova PR, e rodam em segundos. O que cada uma guarda
está em [`docs/doctrine/cercas.md`](docs/doctrine/cercas.md).

**O check do seu PR só mede o seu diff.** Se o CI ficar vermelho por algo que você não tocou, a
falha é do projeto, e a mensagem do job diz isso. Você não precisa consertar a `main` para
entregar a sua mudança.

### O que o CI não vê

- A peça nova tem quem a chame e alimenta alguma coisa. Capacidade solta não entra.
- O que acontece numa chamada aparece na linha do tempo, na tela.
- Todo caminho de erro tem uma fala para quem ligou e um evento para o painel. Nada termina em
  silêncio.
- O operador liga e configura pela tela. Se precisa de SSH, não está pronto.
- O que gasta com provedor é medido e respeita o teto.
- Ação que apaga trabalho pede confirmação e diz o que vai embora.
- Não há regra de um ramo de negócio dentro do núcleo.
- O texto de tela está no tom: profissional, calmo, sem exclamação.
- Código trazido de outro projeto está creditado em [`CREDITS.md`](CREDITS.md).

A lista completa é a Definition of Done do [`AGENTS.md`](AGENTS.md).

## Pegando uma issue: o protocolo "pego esta"

Existe para que duas pessoas não façam o mesmo trabalho sem saber uma da outra.

1. **Comente "pego esta" antes de escrever código.** Uma linha basta. Um mantenedor atribui a
   issue a você. A partir daí ela é sua.
2. **Issue com pessoa atribuída não se duplica.** Quer ajudar? Ofereça no comentário. Não abra
   PR concorrente.
3. **Mantenedor não implementa issue aberta para a comunidade** sem antes se atribuir a ela em
   público.
4. **Sem atribuição depois de 3 dias úteis?** Comece assim mesmo e diga no PR. A demora é
   nossa, e o custo não pode ser seu.
5. **Desistiu ou travou?** Diga na issue. Ninguém fica devendo. Ela volta para a fila com o que
   você descobriu.

## Contribuindo de um fork

**Você está no lugar certo.** Fork é o caminho normal de contribuição, não um caminho de segunda
classe. Algumas coisas vão parecer erro seu e não são:

- **No seu primeiro PR, os workflows ficam parados esperando aprovação.** É política do GitHub
  para quem nunca contribuiu com o repositório. Um mantenedor libera.
- **Você recebe uma mensagem automática em minutos.** É a acolhida. Ela diz o que acontece em
  seguida.

Três tarefas são dos mantenedores, e não suas. Não segure o PR por causa delas:

| Tarefa | Por que é nossa |
|---|---|
| Fragmento de notas de versão em `.changes/` | Quem escreve a nota precisa saber o que o dono de uma VPS terá de fazer. Se você souber escrever, ótimo. Se não, mande sem |
| Conflito com a `main` | A `main` anda rápido. Trazer o seu ramo até ela é trabalho de quem faz o merge |
| Carimbo de tempo da migration | Se outra migration entrou antes da sua, o carimbo é ajustado na fila. Não renomeie por conta própria depois de aberto o PR |

Quando um mantenedor precisa empurrar um ajuste no seu ramo, ele avisa no PR antes, e o faz como
commit novo. Os seus commits ficam como estão.

Não fala inglês ou espanhol e precisou criar uma frase de tela? Mande em português e diga no PR.
A tradução é trabalho de minutos para quem revisa.

## Prazo de resposta

| O quê | Prazo |
|---|---|
| Acolhida automática no PR | Minutos |
| Primeira resposta de uma pessoa, em PR ou issue | Até 3 dias úteis |

Passou do prazo? Comente no PR ou na issue. Cobrar é legítimo, e o silêncio é falha nossa.

## Crédito é lei

- **A autoria é preservada.** O que você escreveu entra com você como autor. Quando um
  mantenedor termina ou ajusta o seu trabalho, você continua como autor ou coautor do commit.
- **O seu nome vai nas notas da versão** em que a mudança sai.
- **PR não se reescreve por fora.** Um mantenedor não fecha o seu PR para reabrir o mesmo
  trabalho no nome dele.
- **Ideia também tem autor.** Se o seu relato ou a sua sugestão originou a mudança, a nota diz.

Se o crédito sair errado, avise. Corrigir tem prioridade.

## Como rodar local

Você precisa de Node 22, pnpm e, para os testes de banco, Docker.

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install
pnpm demo          # uma chamada inteira com o motor simulado (precisa de Docker)
pnpm verify        # o que o CI roda primeiro
pnpm test:db       # sobe sozinho um Postgres descartável (precisa de Docker) e o remove ao fim
```

Você não precisa de tronco SIP nem de chave de IA para contribuir. O motor simulado executa um
roteiro e exercita o caminho inteiro de uma chamada.

Guias para as duas contribuições mais comuns:

- [Adicionar uma ferramenta](docs/guides/adicionar-uma-ferramenta.md)
- [Adicionar um motor de voz](docs/guides/adicionar-um-motor-de-voz.md)

## O que não entra

Para você não gastar tempo num PR que será recusado. As regras de produto completas estão em
[`GOVERNANCE.md`](GOVERNANCE.md).

- Código de nicho no núcleo.
- Qualquer coisa que facilite disparo em massa.
- Recurso que exija SSH para ser ligado.
- Telemetria.
- Recurso pago ou travado.

## Onde pedir ajuda

- **Dúvida sobre como contribuir:** [GitHub Discussions](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions). A resposta fica registrada para quem vier depois.
- **Bug:** [abra uma issue](https://github.com/DeskLabs-OpenSource/DeskVoice/issues).
- **Vulnerabilidade:** nunca em público. Veja [`SECURITY.md`](SECURITY.md).
- **Conduta:** veja [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
