# 0004: Ligações de saída existem e vêm desligadas

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** dono do projeto

## Contexto

Um agente que só atende resolve metade dos casos. Lembrar de uma consulta, confirmar uma
entrega e retornar um contato pedido são usos legítimos de uma ligação feita pelo agente.

O mesmo recurso, sem limite, é uma máquina de disparo. E o ambiente em que ele vai rodar é
este:

- No Brasil, a Anatel bloqueia linhas com padrão de chamadas curtas em massa.
- A regulamentação de telemarketing está em mudança. Segundo noticiado pela imprensa, novos
  critérios de bloqueio valem a partir de 12/11/2026, e a MP 1.396/2026 ainda aguarda
  regulamentação. **O projeto não leu os textos oficiais.** Confira a fonte oficial antes de
  tomar qualquer decisão com base nesta frase.
- O projeto é open source e instalado por pessoas que, em boa parte, não conhecem essas regras.

## Decisão

O recurso de ligações de saída **existe** e **vem desligado**.

O dono da instalação o liga pela tela, depois de declarar a finalidade e a base legal. A partir
daí, toda tentativa de ligação passa por uma checagem única que impõe: teto diário por linha,
lista de não ligar, janela de horário, limite de tentativas por pessoa e aviso de gravação.

O projeto não aceita contribuição que facilite disparo em massa. A lei completa está na
[doutrina de ligações de saída](../doctrine/ligacoes-de-saida.md).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Não ter o recurso | Empurra quem tem uso legítimo para um fork sem limite nenhum. Um recurso com cerca protege mais do que a ausência dele |
| Recurso ligado de fábrica, com os limites | Um padrão ligado decide por quem não leu. A primeira ligação de saída de uma instalação precisa ser um ato consciente |
| Recurso ligado por variável de ambiente | Contraria a regra de que nada exige SSH, e esconde a decisão num arquivo que ninguém lê |
| Limites como recomendação na documentação | Documentação não segura ninguém às 23h de uma sexta. O que protege quem recebe a ligação precisa estar no código |
| Deixar o recurso para uma extensão de terceiros | O ponto mais sensível do sistema ficaria fora da revisão e dos testes do projeto |

## Consequências

**Boas:**

- Uma instalação recém-feita não consegue incomodar ninguém.
- Os casos legítimos cabem dentro dos limites.
- A posição do projeto sobre disparo em massa fica escrita, e a triagem recusa sem precisar
  consultar o dono.

**Custos:**

- Quem quer volume vai reclamar, ou vai embora. É o resultado pretendido.
- Os valores iniciais dos limites são uma escolha conservadora do projeto, e não uma leitura da
  norma. Eles podem estar mais rígidos ou mais frouxos do que a regra aplicável a um caso
  concreto.
- O projeto precisa acompanhar a regulamentação e rever esta decisão quando os textos oficiais
  estiverem publicados e lidos.

**O que esta decisão não é:** aconselhamento jurídico. Quem opera a instalação responde pelo
uso que faz dela.

**Quando rever:** depois da publicação e da leitura dos textos oficiais sobre os novos
critérios de bloqueio e sobre a regulamentação da MP citada.
