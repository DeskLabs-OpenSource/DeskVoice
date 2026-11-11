# 0007: Endereço de operadora compartilhado entre organizações falha fechado

- **Estado:** aceita
- **Data:** 2026-11-11
- **Quem decidiu:** construtor da fundação, depois de três rodadas de revisão de segurança. Fica
  aberta à revisão do dono do projeto.

## Contexto

O Asterisk reconhece de qual linha veio uma ligação de dois jeitos: pela conta registrada
(usuário e senha na operadora) ou pelo endereço de onde o pacote chegou. O segundo jeito é o
único disponível quando a operadora autentica por IP.

Duas organizações na mesma instalação podem usar a mesma operadora, e a mesma operadora manda
as ligações de todo mundo do mesmo endereço. Não existe como o DeskVoice provar a quem um
endereço de operadora pertence.

Tentamos duas regras antes desta, e a revisão reprovou as duas:

1. **Derrubar todas as linhas em conflito.** Uma organização tirava a linha de outra do ar só
   por cadastrar o mesmo endereço.
2. **Dar o endereço a quem cadastrou primeiro.** Quem chegava primeiro passava a receber as
   ligações destinadas à outra organização. A data de chegada ainda morava num arquivo ao lado da
   configuração, que podia ser apagado.

## Decisão

- Reconhecimento por endereço só existe para endereço numérico (IP ou bloco), nunca para nome.
- Se as linhas que disputam um endereço são todas da **mesma** organização, não há risco entre
  organizações: uma delas fica com o endereço e as outras em modo por IP são recusadas como
  configuração repetida.
- Se há linhas de organizações **diferentes** no mesmo endereço, nenhuma é reconhecida por
  endereço. As que autenticam por registro seguem funcionando pela própria conta. As que
  autenticam por IP não sobem, e a tela diz que o endereço está em uso por outra linha da
  instalação, sem revelar qual.
- O casamento pela conta registrada vem antes do casamento por endereço.

## Alternativas descartadas

- **Verificação de posse do endereço por um administrador.** É o desenho certo quando houver
  várias empresas na mesma tela. Hoje a fundação opera uma organização por instalação, e a
  verificação seria uma tela e um fluxo para um caso que quase ninguém tem.
- **Rotear pelo número discado, sem olhar a linha.** Deixaria uma organização reservar o número
  de outra.

## Consequências

- Na ambiguidade, a ligação é recusada. Recusar é melhor do que entregar a ligação, a
  transcrição e o custo à organização errada.
- **Custo assumido:** numa instalação com mais de uma organização, cadastrar uma linha por IP no
  mesmo endereço da linha por IP de outra organização derruba as duas. Quem pode provocar isso é
  quem administra o servidor, porque criar uma segunda organização exige acesso à VPS. Não é um
  estranho.
- Quem revende para vários clientes e usa uma operadora só deve preferir linhas por registro, ou
  uma instalação por cliente.
- Quando a multiempresa chegar à tela, esta decisão precisa ser revista com verificação de posse.
