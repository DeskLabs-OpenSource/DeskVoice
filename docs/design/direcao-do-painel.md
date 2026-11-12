# Direção visual do painel

> O que o painel já faz, escrito para quem vai criar ou mudar uma tela. Cada regra saiu do código
> que existe hoje; nada aqui é desejo. Se o código e este documento discordarem, um dos dois tem
> um defeito: abra uma issue.

A marca (nome, símbolo, logo) tem o seu próprio documento, [`brand/README.md`](../../brand/README.md).
Este trata das telas.

## A direção em uma frase

Calma, da mesma família do DeskcommCRM, com um acento próprio: o cobre, que marca o que está vivo.
A família foi decidida na fundação, como decisão do construtor
([desenho da fundação](../specs/2026-11-10-fundacao-design.md), "Decisões do construtor").

## Do que ela é feita

| Peça | Onde mora | O que faz |
|---|---|---|
| Cores | [`apps/panel/src/design/tokens.css`](../../apps/panel/src/design/tokens.css) | A fonte única. Cada cor é um token `--dv-*` com `light-dark()`: o tema segue o sistema, e `data-theme` no `<html>` força claro ou escuro. Superfícies (`bg`, `surface`, `sunken`, `line`), texto (`text`, `muted`), acento (`accent` e variações) e estados (`ok`, `warn`, `fail`, cada um com a versão `-soft` para fundo) |
| Ponte para o Tailwind | [`apps/panel/src/app/globals.css`](../../apps/panel/src/app/globals.css) | `--color-*: initial` apaga a paleta padrão do Tailwind, e cada token vira uma classe: `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-accent` |
| Texto | [`apps/panel/src/app/fonts/`](../../apps/panel/src/app/fonts/) | Atkinson Hyperlegible (400 e 700, com itálico) em tudo |
| Dado | A mesma pasta, e a classe `.data` em `globals.css` | IBM Plex Mono com dígitos de largura igual, para duração, custo, telefone e horário: números em coluna se alinham |
| Espaço, raio, sombra, movimento | `tokens.css` | Espaço em base de 4 px. Raio sobe com a hierarquia: `xs` em botão e campo, `sm` em aviso, `md` em painel. Sombra só no que flutua: o menu, o botão da chave e o cartão de chamada ao vivo quando o ponteiro passa por cima. Três durações (120, 200, 320 ms) |
| Ícones | `@phosphor-icons/react` | `duotone` na navegação, nos avisos e nos estados; `bold` dentro de botão e em seta |
| Componentes | [`apps/panel/src/ui/kit.tsx`](../../apps/panel/src/ui/kit.tsx) | `Button` (principal, secundário, discreto, perigo), `Field`, `TextInput`, `TextArea`, `Select`, `Switch`, `Badge`, `Panel`, `PageHeader`, `Notice`, `EmptyState`, `Skeleton` |
| Linha do tempo | [`apps/panel/src/ui/timeline.tsx`](../../apps/panel/src/ui/timeline.tsx) e `.thread` em `globals.css` | Um fio com os eventos presos nele. Em tela larga quem ligou fala de um lado e o agente do outro; no celular o fio encosta na margem |

### Onde o cobre aparece

- **O que está vivo:** a chamada em andamento (a borda do cartão, a duração correndo, o ponto que
  pulsa, a ponta do fio na linha do tempo, as barras de voz enquanto o agente fala).
- **O que espera alguém:** o pedido de aprovação (o cartão, a faixa no topo, o contador no menu),
  as notificações não lidas e o link de convite recém-criado, que ainda precisa ser entregue.
- **A ação principal:** o botão principal, a chave ligada, o campo em foco e o contorno de foco.
- **A marca:** o ícone ao lado do nome do produto, no cabeçalho e nas telas de entrada e de convite.

Fora disso, a tela é neutra.

### Contraste

Conferido nesta escrita, em 12/11/2026, pela fórmula de contraste da WCAG sobre os valores de
`tokens.css`: texto e texto secundário sobre as três superfícies, texto sobre o acento, e cada
estado sobre o próprio fundo ficam entre 4,6:1 e 16,9:1 nos dois temas, todos acima de 4,5:1.
Nenhuma cerca refaz essa conta: um token novo precisa ser conferido por quem o cria.

## O que é proibido, e por quê

| Não faça | Por quê | Quem guarda |
|---|---|---|
| Escrever cor como valor (`#fff`, `rgb(`, `hsl(`, `oklch(`) num `.ts` ou `.tsx` do painel | A cor fica fora dos dois temas e da fonte única, e quem muda um token não a encontra. Cor nova vira token em `tokens.css`, com a ponte em `globals.css` | Cerca [`panel-colors-come-from-tokens`](../../fences/panel-colors-come-from-tokens.test.ts) |
| Usar a paleta padrão do Tailwind (`bg-white`, `text-gray-500`) | Ela não acompanha o tema nem a família. Não é preciso lembrar: a classe não gera estilo nenhum | Configuração: `--color-*: initial` em `globals.css` |
| Baixar fonte de fora (`next/font/google`, o serviço de fontes num CSS ou numa tela) | Sem acesso ao serviço, a imagem do painel não constrói; e o download passaria para o navegador de quem usa | Cerca [`fonts-are-vendored`](../../fences/fonts-are-vendored.test.ts) |
| Trazer outra família de fonte | Duas famílias, uma para texto e uma para dado, já cobrem o painel; uma terceira quebra a voz da família do Deskcomm | Revisão |
| Usar o cobre fora do que está vivo ou da ação principal | Se tudo é cobre, nada está vivo: quem opera perde o sinal de que há uma chamada ou um pedido esperando | Revisão |
| Pôr sombra no que não flutua, ou sombra em preto puro | A sombra diz "isto está por cima". As sombras do painel usam a cor do texto neutro | Revisão |
| Criar animação sem o caminho de movimento reduzido, ou estado que só existe em movimento | Com `prefers-reduced-motion`, as animações param, e o que estava vivo continua visível parado (barras em cobre, anel aberto). Estado novo precisa do mesmo | Revisão |
| Escrever texto de tela fora do dicionário | Toda frase existe em pt-BR, inglês e espanhol | Cerca [`ui-text-lives-in-dictionaries`](../../fences/ui-text-lives-in-dictionaries.test.ts) |
| Redesenhar o símbolo ou recompor o nome | A marca tem arquivo pronto | [`brand/README.md`](../../brand/README.md), "O que não fazer" |

A única cor fixa do painel é a moldura do QR Code do WhatsApp (`--dv-qr-surface` e `--dv-qr-ink`):
o mesmo valor nos dois temas, porque a câmera precisa do contraste do código também no tema escuro.
Ela é um token como os outros, e só serve para isso.

## O que ainda não segue a direção

- O cabeçalho do painel desenha um ícone de biblioteca (`Waveform`) em vez do símbolo da marca, e o
  painel não tem ícone de navegador (medição de 12/11, item 4.9).
- Os tamanhos de texto não são tokens: as telas escrevem o valor (`text-[0.87rem]`,
  `text-[1.07rem]`, `text-[1.75rem]`). A escala existe na prática, mas não tem nome.

## Validação do dono

A direção acima está escrita, mas o dono do projeto não a validou. Até aqui ela foi decisão do
construtor. Pedido de decisão, no formato do [`GOVERNANCE.md`](../../GOVERNANCE.md):

### Decisão: a direção visual do painel, como está escrita neste documento, vale como a direção do projeto?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada. A resposta fecha o item 4.7 da medição de conformidade de
12/11 e diz a quem chega se pode propor outra direção.

#### Opções
- **A.** Validar a direção como está. Custo: nenhum trabalho novo; as proibições de revisão passam
  a valer com o peso do dono.
- **B.** Validar com mudanças. Custo: retrabalho nos tokens e nas telas afetadas, e nova conferência
  de contraste.
- **C.** Não validar. Custo: a direção pode ser trocada por quem chegar, sem saber que não foi
  validada, e cada PR de tela reabre a discussão.

#### Recomendação
A, porque a direção já está em todas as telas, cumpre contraste nos dois temas e mantém a família
do Deskcomm decidida na fundação: trocá-la agora custaria retrabalho sem um problema medido que o
justifique.

#### Se ninguém responder em 14 dias, vale: A
A direção escrita vale. Mudança de direção pede um novo pedido de decisão. A opção é reversível:
trocar a direção depois é trocar tokens e telas, sem tocar em dado.

#### Não medido
A direção não foi testada com quem opera o painel. O contraste foi calculado, não medido em tela.

#### Resposta do dono
<!-- O dono escreve aqui: "Validado em AAAA-MM-DD" ou o que muda. -->
