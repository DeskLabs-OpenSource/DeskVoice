# Doutrina de um arquivo por peça

> Lei sobre **onde uma peça mora**: cada ferramenta, motor de voz, rotina e dicionário de tela
> vive no próprio arquivo e é descoberto pela pasta. Não existe lista central que todo PR edita.

## O princípio-raiz

A pergunta que decide a forma do repositório:

> **"Dois PRs que não têm nada a ver um com o outro editam o mesmo arquivo?"**

Se sim, eles vão colidir, e a colisão vai cair no colo de quem chegou por último. Em projeto com
muitos contribuidores, quem chega por último quase sempre é quem está de fora.

## O erro que originou a regra

No DeskcommCRM, peças novas se registravam em arquivos compartilhados: um dicionário único para
todas as frases de tela, um retrato único do schema. Cada PR acrescentava linhas ao mesmo
arquivo. O resultado medido foi colisão: PRs bons e independentes entravam em conflito entre
si, e o contribuidor recebia um conflito que não tinha causado e não sabia resolver.

O conflito não era de ideias. Era de endereço.

## A régua

| Peça | Mora em | Como é encontrada |
|---|---|---|
| Ferramenta que o agente usa na chamada | Um arquivo em `packages/tools/src/tools/` | `loadTools()` lê a pasta |
| Motor de voz | Um arquivo em `packages/voice-engine/src/engines/` | `loadEngines()` lê a pasta |
| Rotina pós-chamada | Um arquivo em `apps/routines/src/routines/` | O consumidor da fila lê a pasta |
| Texto de tela | Um arquivo por funcionalidade e por idioma em `apps/panel/src/i18n/` | Carregado pela funcionalidade |
| Mudança de banco | Um arquivo novo em `db/migrations/`, com carimbo de tempo | O executor aplica em ordem |
| Nota de versão | Um fragmento por mudança em `.changes/` | O lançamento junta os fragmentos |
| Cerca | Um arquivo em `fences/` | O Vitest roda a pasta |

Acrescentar uma peça é **criar um arquivo**. Se o seu PR precisa editar um segundo arquivo só
para avisar o sistema de que o primeiro existe, a regra foi quebrada em algum lugar.

## Como aplicar

1. **Peça nova, arquivo novo.** O nome do arquivo é o nome da peça.
2. **A peça se descreve sozinha.** Nome, descrição e parâmetros estão no próprio arquivo, e não
   numa tabela ao lado.
3. **O teste da peça mora ao lado dela.**
4. **Precisou de uma lista para exibir na tela?** Gere a lista a partir da descoberta. Não
   escreva a lista à mão.
5. **Dois arquivos nunca disputam o mesmo nome.** Para migrations, quem garante é o carimbo de
   tempo. Para ferramentas e motores, o nome do arquivo.

## O que continua centralizado, de propósito

Nem tudo deve ser espalhado. Estas coisas têm um ponto único, e mudá-las é uma decisão, não um
registro:

- **O vocabulário de eventos de chamada.** É fechado. Evento novo muda o contrato de quem lê a
  linha do tempo.
- **As interfaces `Tool` e `VoiceEngine`.** São o contrato entre as peças.
- **A camada de acesso a dados.** Uma só, como diz a [doutrina de isolamento](isolamento.md).

A diferença: nesses arquivos a edição é rara e merece revisão atenta. Num arquivo-índice a
edição é rotineira e não merece atenção nenhuma, e é por isso que ele colide.

## Verificação

- Existe um teste que cria uma ferramenta nova na pasta e confere que ela é descoberta sem editar
  outro arquivo. O mesmo vale para as rotinas.
- A cerca de migrations reprova carimbo repetido ou fora do padrão.
- Na revisão: um PR de ferramenta nova que toca arquivo fora da pasta da ferramenta precisa
  explicar por quê.

## Documentos relacionados

- [`um-caminho-de-schema.md`](um-caminho-de-schema.md): a mesma ideia aplicada ao banco.
- [`cercas.md`](cercas.md): como a regra é cobrada.
- Guias: [adicionar uma ferramenta](../guides/adicionar-uma-ferramenta.md) e
  [adicionar um motor de voz](../guides/adicionar-um-motor-de-voz.md).
