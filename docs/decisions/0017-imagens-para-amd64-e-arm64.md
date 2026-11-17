# 0017: As imagens publicadas atendem amd64 e arm64

- **Estado:** proposta; passa a valer quando o PR que a traz entrar na `main` (a [0013](0013-imagens-so-amd64.md) previu esta revisão)
- **Data:** 2026-11-14
- **Quem decidiu:** os mantenedores, porque é decisão técnica (as arquiteturas publicadas e o caminho da publicação), que a tabela "Quem decide o quê" do [`GOVERNANCE.md`](../../GOVERNANCE.md) dá a eles ("pedidos de decisão técnicos") e não ao dono. A proposta é de @webtecnica, no PR #228, a partir do pedido da issue [#120](https://github.com/DeskLabs-OpenSource/DeskVoice/issues/120); a conferência do índice antes de baixar em ARM veio do parecer da revisão do PR

## Contexto

A [0013](0013-imagens-so-amd64.md) publicava só `linux/amd64` e deixou duas condições de revisão: quando alguém pedisse imagem arm64 publicada, e quando o runner ARM do GitHub estivesse disponível sem custo para repositório público. As duas aconteceram.

O pedido veio na issue #120, com o caso concreto: uma VM Oracle Cloud Ampere A1 (aarch64, 2 OCPU, 12 GB, plano gratuito), que já atende o DeskcommCRM com imagens arm64. Nela, a instalação do DeskVoice só existe construindo as três imagens na própria máquina (`--build`): segundo o [`instalacao-real.md`](../fundacao/instalacao-real.md), voz e rotinas têm cerca de 940 MB cada, e o tempo e a memória dessa construção em ARM nunca foram medidos. Construir isso na máquina que atende o CRM em produção é o que o pedido quer evitar.

O runner ARM do GitHub existe e é sem custo em repositório público: o rótulo é `ubuntu-24.04-arm` e o `ubuntu-22.04-arm` (GitHub, *Linux arm64 hosted runners now available for free in public repositories*, 16/01/2025, e a disponibilidade geral depois). O `DeskVoice` é aberto, então o rótulo vale aqui. Nenhuma imagem foi construída nesse runner nesta proposta: a publicação real não rodou.

As bases do [`Dockerfile`](../../Dockerfile) não impedem a construção nativa: `node:22.23.5-alpine@sha256:1314fb30…` é um índice que declara `linux/arm64/v8`, conferido com `docker buildx imagetools inspect`. As peças de terceiros do Compose também têm arm64 — `postgres:17.11-alpine`, `caddy:2.11.9-alpine`, `andrius/asterisk` e o WaCalls fixado —, e o WAHA já trocava de imagem em ARM (`WAHA_IMAGE_ARM64`, decisão [0012](0012-whatsapp-por-qr-code.md)).

## Decisão

As imagens publicadas passam a atender `linux/amd64` e `linux/arm64`, na mesma etiqueta `X.Y.Z`, a partir da primeira versão publicada com este workflow, e a instalação em ARM puxa em vez de construir quando a versão tem a imagem.

1. **Um job por arquitetura.** O `publish-image.yml` constrói cada arquitetura no seu próprio runner: `amd64` em `ubuntu-latest`, `arm64` em `ubuntu-24.04-arm`. Não há emulação (QEMU) em nenhum dos dois: a construção é nativa, e o arm64 não custa tempo de emulação ao amd64.
2. **As duas em paralelo, nenhuma espera a outra para construir.** Cada job tem o seu teto de 90 minutos (o mesmo de antes) e `fail-fast: false`: a arquitetura que falha não derruba o log da outra.
3. **Publicação por resumo, um índice no fim.** Cada job publica as três imagens por resumo (`push-by-digest`), sem etiqueta, e guarda os resumos num artefato. O job `merge` junta os dois resumos de cada imagem com `docker buildx imagetools create --tag`. Etiqueta é um ponteiro só: se os dois jobs publicassem a mesma etiqueta, quem chegasse por último apagaria o índice do outro. A junção é achatada — o resultado tem um manifesto por arquitetura, mais os manifestos de atestado, conferido num registro local com `registry:2`.
4. **A etiqueta nasce com as duas arquiteturas, ou não nasce.** O `merge` recusa quando falta o resumo de uma delas, e o `verify-public` confere, em cada uma das três imagens, que o índice lista `linux/amd64` e `linux/arm64` antes de a release ser publicada. Uma versão com arm64 numa entrega e sem ele na seguinte quebraria a instalação em ARM no meio da lista de versões — o que a 0013 já recusava.
5. **O resto do fluxo não muda.** A publicação continua saindo só de tag `vX.Y.Z` de commit da `main`, a etiqueta continua sendo `X.Y.Z` sem `v`, a visibilidade pública dos pacotes continua conferida, e a release continua sendo o último job. Nada é publicado a cada push.
6. **A instalação em ARM confere antes de baixar.** Nenhuma versão publicada antes desta decisão tem arm64, e o `--to` do atualizador e o `DESKVOICE_VERSION` do instalador continuam aceitando qualquer uma. Em ARM, `install.sh` e `update.sh` pedem ao ghcr.io o índice da versão, com o token anônimo de leitura, como o `docker pull` faz. Se o índice lista `linux/arm64`, baixam como no amd64. Se não lista, param antes de baixar (o atualizador, antes do backup) com a frase de antes, agora dizendo que aquela versão não tem imagem ARM e apontando o `--build`. Se o registro não responde, avisam e seguem, e o download diz o resto. Em amd64 não há pergunta: toda versão tem amd64. `--build` continua existindo para quem quer rodar o código da pasta, em qualquer arquitetura.
7. **A construção local não vira multiarquitetura.** `pnpm`, `docker compose build` e o `--build` da instalação continuam construindo uma arquitetura só, a da máquina. O `install` do CI não muda.

## Alternativas

| Alternativa | O que é | Por que não |
|---|---|---|
| arm64 por QEMU num job separado | O job do arm64 no runner amd64, com emulação, sem bloquear o amd64 | Mantém a construção várias vezes mais lenta e de tempo nunca medido, e não há ganho: o runner ARM nativo é sem custo em repositório público |
| Publicar as duas arquiteturas no mesmo passo | `platforms: linux/amd64,linux/arm64` num único job | Num runner só, uma das duas sai por emulação, e uma falha de uma interrompe a construção da outra no mesmo passo, sem log separado. A publicação ficaria refém do arm64 do mesmo jeito que no desenho escolhido (ver Consequências), com a construção mais lenta |
| Etiqueta por arquitetura (`X.Y.Z-amd64`, `X.Y.Z-arm64`) | Cada job publica a sua etiqueta e o merge usa as duas | Deixa duas etiquetas sem leitor no registro, e a instalação continuaria pedindo só `X.Y.Z`. Etiqueta que ninguém pede acaba usada por alguém |
| amd64 sai sozinho quando o arm64 falha | O `merge` publica a etiqueta com o que existir e o `verify-public` avisa | A versão sairia às vezes com arm64, às vezes sem. Quem instala em ARM veria a versão na lista e não conseguiria puxá-la |
| Manter ARM só com construção local | Como está desde a 0013 | É o que a issue #120 pede para mudar: construir duas imagens de ~940 MB na VM que já atende o CRM |

## Consequências

- **Uma falha do build arm64 segura a publicação da versão para todo mundo.** Sem o resumo do arm64, o `merge` não etiqueta, o `verify-public` e a `release` não rodam, e quem está em amd64 também fica sem a versão. É o refém que a 0013 recusou, aceito aqui de propósito: a alternativa de publicar o amd64 sozinho faria a versão sair às vezes com arm64 e às vezes sem. Os jobs separados resolvem o log e o tempo de construção, não esse acoplamento.
- **O workflow não tem jeito de não segurar.** Não há entrada, variável nem matriz opcional que publique só o amd64: o `merge` exige os dois resumos, e o `verify-public` exige as duas arquiteturas. Publicar só o amd64 pede um PR que tire a linha arm64 da matriz e a exigência das duas arquiteturas, o que é revisar esta decisão. A instalação em ARM aguentaria essa versão sem arm64, porque a conferência do item 6 para com a frase clara.
- **Quando o build arm64 falha, o que se faz.** Ler o log do `build (arm64)`. Falha passageira (runner, rede, registro): *Re-run failed jobs* no mesmo run, que refaz o arm64 e os jobs que dependem dele. O resumo do amd64 fica num artefato que dura um dia; passado isso, o `merge` acusa a falta dele e o caminho é reexecutar o run inteiro, que publica de novo por resumo, sem etiqueta para sobrescrever, porque o `merge` não chegou a etiquetar. Falha do código no arm64: o conserto entra por PR e sai numa versão nova. Enquanto isso, a tag `vX.Y.Z` existe no git sem imagem nem release, e uma instalação nova a pega como a mais recente e para no download (em amd64, com a mensagem de imagem que não baixa; em ARM, com a frase da conferência). Nenhum desses caminhos foi exercitado.
- A publicação passa a ter cinco jobs (probe, dois builds, merge, verificação e release) e um artefato com os resumos, que dura um dia.
- O tempo da construção arm64 no runner nativo não foi medido. Se ela estourar os 90 minutos em algum release, o remédio é subir o teto daquela linha da matriz, não voltar para a emulação.
- O arm64 passa a ter a sua própria cópia das camadas: as duas arquiteturas não dividem camadas entre si (a base do Node é outra), e o registro guarda as duas. A divisão de camadas entre voz e rotinas é conferida por arquitetura, como antes.
- Quem já instalou em ARM com `--build` (versão `local`) pode passar para uma versão publicada com imagem ARM com `bash install/update.sh --to <versão>`: o atualizador confere o índice e baixa. Para uma versão sem imagem ARM, ele para antes do backup e diz. Isso não foi exercitado numa máquina ARM real.
- A publicação real do arm64 não foi executada nesta proposta: nenhum release rodou com o workflow novo.

## Quando revisar

- Depois do primeiro release que publique arm64, com o tempo de cada job lido no Actions: se o arm64 passar de 60 minutos com folga pequena, o teto e o cache de camadas entram em pauta.
- Quando houver uma instalação em ARM relatada: ela é a primeira medida de memória, disco e tempo em Ampere, Graviton ou similar.
- Em qualquer caso, até 2027-05-14.
