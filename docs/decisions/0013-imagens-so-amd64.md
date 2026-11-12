# 0013: Imagens publicadas só para amd64

- **Estado:** aceita, em vigor desde a 0.1.0
- **Data:** 2026-11-11 (decidida no PR #10); registrada em 2026-11-12
- **Quem decidiu:** o construtor, no segundo commit do PR #10, em resposta ao parecer do PR; o dono mesclou. O registro veio depois, cobrado pelo item 12.5 da régua da Fábrica: declarar menos arquiteturas do que o produto já declarou pede decisão escrita.

## Contexto

Até o PR #10, o `publish-image.yml` construía as três imagens (`panel`, `voice`, `routines`) para `linux/amd64,linux/arm64` num passo só, com o arm64 por emulação (QEMU) no runner amd64 do GitHub, dentro de um teto de 60 minutos. Nenhuma versão chegou a sair assim: a 0.1.0 já foi publicada só para amd64.

O problema era o acoplamento. As duas arquiteturas saíam do mesmo passo, e a emulação é várias vezes mais lenta que a construção nativa (o `pnpm install` e o `next build` do painel são os passos pesados). Se o arm64 estourasse o teto, o passo inteiro falhava e **nada** era publicado, nem o amd64, que é onde está quase toda VPS. E a tag já existia: a versão ficava anunciada no CHANGELOG e no repositório, sem imagem para baixar. A construção arm64 por QEMU dentro dos 60 minutos nunca foi medida; o PR #10 a listou como não verificada.

## Decisão

As imagens publicadas são só para `linux/amd64`. O workflow declara `platforms: linux/amd64`, e o README diz isso na tabela do que ter em mãos.

Quem tem processador ARM de 64 bits (arm64) instala construindo as imagens na própria máquina, com `bash install/install.sh --build`. O instalador detecta a arquitetura e diz isso antes de começar: sem `--build`, numa máquina arm64, ele para com o motivo e o comando (`install/install.sh`, linhas do bloqueio "Ainda não há imagem publicada do DeskVoice para processador ARM"). Quem constrói na própria máquina atualiza só pelo terminal; a atualização pela tela baixa imagens publicadas ([`0010-atualizar-pela-tela.md`](0010-atualizar-pela-tela.md)).

## Alternativas

| Alternativa | O que é | Por que não agora |
|---|---|---|
| Runner ARM nativo e junção de manifesto | Um job por arquitetura, cada um no seu runner (o arm64 num runner ARM do GitHub), publicando por resumo; um último job junta os dois num índice multiarquitetura com `docker buildx imagetools create` | É o caminho certo quando houver pedido. Custa um job a mais, a junção e a conferência do índice antes de publicar a release; e o amd64 continua precisando sair mesmo que o ARM falhe, o que pede decidir se uma versão pode sair com uma arquitetura só |
| Emulação em job separado | O arm64 por QEMU num job próprio, que não bloqueia o amd64 | Resolve o refém, mas mantém a construção lenta e de tempo nunca medido, e a versão sairia com a imagem arm64 às vezes sim, às vezes não. Arquitetura que aparece e some de uma versão para outra é pior que arquitetura não declarada |
| Manter os dois no mesmo passo e subir o teto | Como era, com mais tempo | O acoplamento continua: qualquer falha do arm64 derruba o amd64 |

## Consequências

- Em VPS arm64 (Ampere, Graviton), a instalação demora mais, porque constrói as imagens, e pede mais memória e disco durante a construção; nada disso foi medido.
- A construção local usa a mesma base fixada do `Dockerfile` (Node por versão e resumo), e o índice dela tem arm64: o que muda entre as duas instalações é quem construiu, não a base.

## Quando revisar

- Quando alguém pedir imagem arm64 publicada (issue ou discussão), ou quando uma instalação em ARM for relatada.
- Quando o runner ARM do GitHub para repositório público estiver disponível sem custo para este repositório, o que torna a primeira alternativa barata. Não conferido em 12/11/2026.
- Em qualquer caso, até 2027-05-12.
