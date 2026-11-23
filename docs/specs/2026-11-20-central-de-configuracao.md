# A central de configuração: o menu em grupos e Configurações em cartões

- **Estado:** desenho. As partes 1 e 2 podem começar. As partes 7 e 8 esperam a decisão do dono
  (seção 6).
- **Data:** 2026-11-20
- **Quem pediu:** o dono, em 20/11: "está bem bagunçada, sem organização e sem hierarquia de
  informações. Reorganizar os menus laterais, a parte de configurações está muito sobrecarregada de
  abas e funções". Entre três caminhos propostos, ele escolheu o C: "Pode seguir com c".
- **Base medida:** `origin/main` em `b46e626`. Arquivos, linhas e nomes citados foram conferidos
  nesse commit, salvo os marcados como **novo**.
- **Segue:** [`docs/design/direcao-do-painel.md`](../design/direcao-do-painel.md). Nenhuma cor,
  fonte ou token novo. Os componentes são os de `ui/kit.tsx` (`Panel`, `Badge`, `Notice`,
  `PageHeader`).

## 1. Problema

O painel cresceu por acréscimo, e a configuração não tem hierarquia:

- `settings/layout.tsx:28-40` desenha **11 abas do mesmo peso**. No celular, "Sua conta" fica fora
  da faixa visível.
- A chave de provedor é pedida em cinco telas: `settings/page.tsx`, `settings/brains`,
  `settings/voice/card.tsx` e `settings/speech-filter`, além dos tokens de `whatsapp` e
  `integrations`.
- `settings/page.tsx` (471 linhas) mistura a chave do motor, que é coisa do primeiro dia, com
  Desfecho, Análise e Transcrição, que são opcionais e têm custo.
- O WhatsApp aparece em quatro lugares, e a gravação em três: o aviso em Ligações, a gravação em
  Privacidade e a transcrição em IA.
- `privacy-panel.tsx` (556 linhas) junta 8 painéis.
- O menu lateral (`ui/shell.tsx:33-43`) tem 9 itens soltos, sem grupo.
- A atualização mora em dois lugares, e quem decide qual é o `installationExplicit` (`ui/me.tsx:25-28`,
  `settings/system/page.tsx`).

Quem configura não sabe por onde começar, nem o que já está pronto.

## 2. A forma

**O menu lateral ganha títulos de grupo.** Nenhuma rota muda.

| Grupo | Itens |
|---|---|
| Atendimento | Chamadas, Aprovações, Pendências |
| Montar | Agentes, Linha telefônica, Ligações de saída |
| Acompanhar | Custos |
| Organização | Equipe, Configurações |
| (bloco da conta, no fim) | Minha conta, tema, idioma, "Administrar a instalação" |

**`/settings` vira uma central de cartões.** Cada cartão diz o estado da área e abre a tela que já
existe. Ordem:

1. **Primeiros passos.** Some quando tudo estiver pronto.
2. **Inteligência artificial:** Motores de voz, Cérebros, Voz, Filtro de fala.
3. **Durante e depois da ligação:** Analistas; Desfecho, análise e transcrição.
4. **Canais:** WhatsApp, Webhooks.
5. **Regras das ligações.**
6. **Privacidade e dados.**

As subtelas perdem a barra de abas e ganham "← Configurações". O técnico e o raro ficam num
`<details>` nativo, "Avançado", fechado por padrão.

**Respostas padrão** (o dono não respondeu; valem estas):

- O operador continua vendo os grupos "Montar" e "Organização" como hoje. Só "Equipe" continua
  escondido para ele.
- A aba "Voz" continua, dentro de "Avançado", com o aviso que já existe.
- A ligação pelo WhatsApp fica onde está até a parte 7.

**A rota de IA é `/settings/ai`**, e não `/settings/ia` como no pedido. As outras dez rotas de
Configurações têm nome em inglês (`brains`, `speech-filter`, `privacy`), e a chave da seção no
dicionário já é `ai`.

## 3. As partes

Cada parte é um PR que se revisa numa sentada e pode entrar sozinho. **Nenhuma rota antiga
quebra:** um favorito em qualquer `/settings/*` continua chegando a uma tela que funciona.

### Parte 1: títulos de grupo no menu lateral (pequena)

- **Contrato:** `NAV` em `ui/shell.tsx` vira uma lista de grupos, e cada grupo tem uma chave e os
  seus itens. Os títulos ficam em `i18n/*/common.ts` (**novo**: `navGroups.attend`, `build`,
  `follow`, `organization`), nos três idiomas. A ordem dos itens é a da tabela da seção 2. O filtro
  de "Equipe" para o operador continua igual, e um grupo sem itens visíveis não mostra o título. No
  celular, o título vira um separador discreto: uma linha `border-line` ou o texto `text-muted` em
  tamanho menor. Nenhum token novo.
- **Aceite:** quem abre o painel vê os 9 itens nos 4 grupos, na ordem da tabela, nos três idiomas.
  O operador vê "Organização" só com "Configurações". Os mesmos `href` de hoje. O e2e que clica no
  menu continua passando.
- **Fracasso mesmo funcionando:** o título de grupo aparece como link ou recebe foco de teclado. Ou
  o menu do celular fica mais alto que a tela num aparelho de 640 px.
- **Fora:** o bloco da conta (parte 4).

### Parte 2: o conteúdo de `/settings` vai para `/settings/ai` (pequena)

- **Contrato:** o arquivo atual `settings/page.tsx` muda de lugar para `settings/ai/page.tsx`
  (**novo**), sem mudar o conteúdo além dos caminhos de importação. `settings/page.tsx` passa a
  chamar `redirect("/settings/ai")`. A primeira entrada de `SECTIONS` em `settings/layout.tsx`
  aponta para `/settings/ai`. Os links que mandam cadastrar a chave passam a apontar para
  `/settings/ai`:
  - `calls/page.tsx:71`;
  - `calls/talk/page.tsx:127` e `:209`;
  - `agents/[id]/page.tsx:353`.

  Antes de abrir o PR, um `git grep '"/settings"'` em `apps/panel/src` não pode achar link de
  chave.
- **Aceite:**
  - `/settings` abre a tela de IA de hoje, com a mesma aba marcada;
  - os quatro links caem em `/settings/ai`;
  - `settings.spec.ts` passa;
  - `config-de-seguranca.test.ts` continua achando `/settings`.
- **Fracasso mesmo funcionando:** o redirecionamento passa por uma tela intermediária visível, ou
  perde o `?` e o `#` de quem chegou com eles.
- **Fora:** a central (parte 3).

### Parte 3: a central em `/settings` (média)

- **Contrato:** `settings/page.tsx` deixa de redirecionar e desenha os cartões da seção 2, cada um
  com:
  - o título;
  - uma frase do que a área faz;
  - um `Badge` de estado (pronto, falta algo, desligado), lido das rotas `GET` que as telas já
    chamam.

  **Nenhuma rota de API nova.** Uma área sem leitura barata de estado fica sem `Badge`, e não ganha
  rota nesta parte.

  "Primeiros passos" reaproveita a lista de `calls/page.tsx:68-72`, que passa para um módulo
  comum (**novo**, por exemplo `ui/first-steps.ts`) usado pelas duas telas. O cartão some quando
  os três passos estão feitos. Os textos novos vão em `i18n/*/settings.ts`. Nesta parte, a barra
  de abas continua nas subtelas. Na própria central, a barra não mostra aba marcada.
- **Aceite:**
  - numa organização nova, a central mostra "Primeiros passos" com os três passos pendentes;
  - com agente, linha e chave, o cartão some;
  - cada cartão abre a tela que já existe;
  - o operador vê a central só para ler;
  - um e2e novo em `settings.spec.ts` cobre o cartão que some.
- **Fracasso mesmo funcionando:** o `Badge` diz "pronto" para uma área que não funciona. Exemplo:
  WhatsApp "pronto" com a sessão desconectada. Ou a central dispara mais de uma leitura por área.
  Na dúvida, sem `Badge`.
- **Fora:** tirar a barra de abas (parte 4) e separar os opcionais (parte 5).

### Parte 4: "← Configurações" no lugar da barra de 11 abas (média)

- **Contrato:** `settings/layout.tsx` deixa de desenhar `SECTIONS`. Fora de `/settings`, ele
  desenha um link "← Configurações" acima do `PageHeader` da subtela. O `ReadOnlyNotice` e o
  `LimitsNotice` continuam como estão. "Sua conta" entra no bloco da conta de `ui/shell.tsx` como
  "Minha conta", e `/settings/account` continua sendo a rota. A barra de `installation/nav.tsx`
  não muda.
- **Aceite:**
  - nenhuma subtela mostra a barra;
  - toda subtela de `/settings/*` tem o link de volta, e só elas;
  - "Minha conta" está no bloco da conta, nos três idiomas, inclusive no celular;
  - os e2e tocados passam.
- **Fracasso mesmo funcionando:** uma tela de configuração fica sem caminho de chegada pela
  central, ou seja, órfã. Conferir as 11 entradas de `SECTIONS`, uma a uma, contra os cartões da
  parte 3.
- **Fora:** juntar as barras de `settings` e `installation` num componente só. Depois desta
  parte, a de `settings` deixa de existir.

### Parte 5: separar o primeiro dia do opcional na tela de IA (média)

- **Contrato:** `/settings/ai` fica só com as chaves dos motores (`EngineKey`). Desfecho, Análise e
  Transcrição vão para uma subtela nova, `/settings/after-call` (**novo**), que o cartão "Durante
  e depois da ligação" abre junto com Analistas. Os componentes mudam de arquivo e o comportamento
  fica igual. As chaves de configuração e as rotas de API não mudam.
- **Aceite:**
  - quem ligava um opcional em `/settings` o encontra pelo cartão "Durante e depois da ligação",
    com o mesmo valor salvo;
  - `/settings/ai` não mostra mais nenhum opcional com custo;
  - os testes de componente que existem passam sem mudar o que conferem.
- **Fracasso mesmo funcionando:** um opcional ligado aparece desligado na tela nova, ou seja, lido
  de outra chave.
- **Fora:** juntar as chaves de cérebro, voz e filtro numa tela só. As cinco telas de chave
  continuam cinco: só o ponto de entrada muda.

### Parte 6: "Avançado" fechado por padrão (pequena)

- **Contrato:** um `<details>` nativo, com o rótulo "Avançado" em `i18n/*/settings.ts`, envolve
  quatro itens:
  - o endpoint de classificação (`ClassifyTarget`, hoje em `settings/page.tsx:47`);
  - o conector externo do WhatsApp (`whatsapp-panel.tsx`);
  - "Confiar no número exibido na ligação" (`settings/whatsapp/page.tsx:119-123`);
  - exportar, esquecer e apagar, em `privacy-panel.tsx`.

  Abre sozinho quando o endereço traz a âncora dele (`#avancado`). O aviso do agente
  (`dropFollowUpNotTrusted`) e o erro `drop_follow_up_caller_id_not_trusted` mandam para
  "Confiar no número". Por isso, o link que leva a ele aponta para a âncora.
- **Aceite:**
  - os quatro itens estão fechados ao abrir a tela;
  - o link do aviso do agente abre a tela com "Avançado" aberto;
  - `forget-caller.spec.ts` e `drop-follow-up-whatsapp.spec.ts` passam, abrindo o `<details>`
    quando preciso.
- **Fracasso mesmo funcionando:** quem segue o aviso "ligue Confiar no número" chega e não acha a
  chave.
- **Fora:** mudar o comportamento de qualquer um dos quatro.

### Parte 7: a ligação pelo WhatsApp e o aviso de gravação (média, espera decisão)

A proposta tem duas mudanças:

- o painel da ligação pelo WhatsApp (`whatsapp-calls-panel.tsx`, hoje dentro de
  `settings/whatsapp/page.tsx:18`) vai para perto da Linha (`/line`);
- o aviso de gravação, hoje em `settings/calls/page.tsx:134`, e a gravação em `privacy-panel.tsx`
  ganham um só lugar, que é Privacidade.

As duas mudam o lugar de coisas que quem já usa conhece. Por isso, a parte não se constrói antes
da decisão (seção 6).

**Quando o "mudou para…" sai** (acrescentado em 23/11, depois do merge do #520 em `c9398a3`): o
aviso nos dois lugares antigos (`movedWhatsAppCalls` em `settings/whatsapp/page.tsx` e
`movedRecordingNotice` em `settings/calls/page.tsx`) vai **só na 0.46.0** (`b41c3eb`, 23/11), a
primeira versão cortada com o #520, e sai **antes do corte seguinte à 0.46.0**, seja ele 0.46.1 ou
0.47.0. O número vem da seção do `CHANGELOG.md` que traz o título do fragmento ("A ligação pelo
WhatsApp passa para a tela…"). O corpo do #520 dizia "até o corte seguinte à 0.42.0", mas o número
estava errado: a 0.42.1 e as versões até a 0.45.0 saíram sem ele.
A cerca `moved-notice-leaves-after-one-version` prende a saída. Quando o `CHANGELOG.md` tiver uma
versão mais nova que a 0.46.0 e as chaves ainda existirem no painel, ela reprova. Quem a vê
vermelha é o PR da versão seguinte, então o PR que tira o aviso entra antes dele. O que a cerca não
pega: o título trocado à mão no `CHANGELOG.md` (o arquivo diz "não edite à mão"), e o aviso que
volta com outra chave.
O aviso saiu antes do corte da 0.47.0 (DESA-394): as duas telas, as três chaves nos três idiomas
(`movedWhatsAppCalls`, `movedRecordingNotice`, `movedLink`) e os testes de tela. A entrada em
`MOVED_NOTICES` fica: ela reprova a volta dessas chaves.

### Parte 8: a atualização só na área da instalação (pequena, espera decisão)

A proposta é que `settings/system/page.tsx` sempre redirecione. Quem administra a instalação vai
para `/installation/update`, e quem não administra vai para `/settings`. `updatePath` em
`ui/me.tsx` passa a depender só de `installationAdmin`.

`isInstallationAdmin` (`packages/core/src/accounts.ts:253`) já conta o dono e o administrador da
organização fundadora enquanto a lista não é explícita. São as mesmas pessoas que hoje podem
atualizar.

A tela de atualizar é caminho sensível: a parte espera a decisão (seção 6). Ela também espera o
#496, que mexe em `ui/types.ts`.

## 4. Distribuição

| Trilha | Ordem | Arquivos |
|---|---|---|
| A (Desenvolvedor) | Parte 1, depois a 4 | `ui/shell.tsx`, `i18n/*/common.ts`; depois `settings/layout.tsx` |
| B (Desenvolvedor 2) | Parte 2, depois 3, 5 e 6 | `settings/page.tsx`, `settings/ai/`, `calls/`, `agents/[id]/page.tsx:353`, `i18n/*/settings.ts` |

A parte 4 começa depois que as partes 1 e 3 entram. As partes 7 e 8 entram em quem estiver livre,
depois da decisão.

**Conflito com o R8 em andamento:**

- #495 e #496 mexem em `installation/*`, `ui/types.ts` e `agents/[id]/page.tsx`, nas linhas 18,
  115 e 137;
- #487 mexe em `agents/[id]/page.tsx`, na linha 360.

A parte 2 muda só a linha 353 desse arquivo, fora dos trechos deles, e o resto não se cruza. A
parte 8 é a única que encosta no R8: espera o #496.

## 5. O que fica de fora

- Rota de API nova.
- Mudança de comportamento de qualquer configuração.
- Unir as cinco telas de chave.
- Mexer na área da instalação, além da parte 8.
- Cor, fonte ou token novo.

## 6. Pedidos de decisão (partes 7 e 8)

Vão ao lote do Líder antes de construir, com a recomendação:

- **Parte 7:** a recomendação é A, mover, com um aviso de uma linha no lugar antigo por uma
  versão. Padrão se ninguém responder: não mover, porque é reversível.
- **Parte 8:** a recomendação é A, redirecionar sempre, porque as mesmas pessoas chegam à mesma
  tela. Padrão: não mudar.

## Não medido

- A página da proposta do designer (o artefato em claude.ai) não foi aberta. Este desenho parte do
  resumo da tarefa, conferido contra o código.
- Não medi o custo das leituras de estado da parte 3, nem se cada área tem uma leitura `GET`
  barata. A regra da parte 3 ("sem leitura barata, sem `Badge`") cobre o caso.
- Não abri os quatro e2e citados: quais asserções quebram em cada parte fica para quem constrói.
- Não conferi o menu do celular num aparelho de verdade.
