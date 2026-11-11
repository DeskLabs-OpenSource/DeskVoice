# 0003: Postgres dentro da VPS

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** dono do projeto

## Contexto

O DeskcommCRM usa o Supabase na nuvem como banco. Isso facilitou o começo e cobrou o preço na
operação: **cota e lentidão do banco na nuvem foram a reclamação operacional mais repetida** de
quem instalou. Quando o banco na nuvem estourava a cota ou respondia devagar, o sistema parava
junto.

Para uma central telefônica, o banco fora da máquina tem um agravante: a chamada acontece em
tempo real. Gravar um evento ou buscar o agente de um número não pode depender de uma rede
externa enquanto alguém espera na linha.

## Decisão

O banco padrão é **Postgres 17 rodando na própria VPS**, num contêiner da mesma instalação.

A mesma instância serve de **fila**: quando uma tarefa é criada, o banco notifica quem consome
(LISTEN/NOTIFY). Não há serviço de fila à parte nem consulta em laço curto.

Usuários e sessões do painel também moram nesse Postgres. A instalação não depende de serviço
de autenticação externo.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Supabase na nuvem como padrão | A reclamação operacional mais repetida do Deskcomm. Além disso: uma conta a mais para criar antes de instalar, latência de rede no caminho da chamada e dado sensível de chamadas fora da máquina do dono |
| Supabase instalado na própria VPS | Resolve a cota, mas traz um conjunto de serviços que a fundação não usa. Mais memória e mais peças para manter numa VPS pequena |
| SQLite | Três processos escrevem ao mesmo tempo, e a fila depende de notificação e de reivindicação concorrente de tarefas. O Postgres entrega as duas coisas prontas |
| Redis ou outro serviço para a fila | Mais um serviço para instalar e monitorar, para resolver o que o banco já resolve |

## Consequências

**Boas:**

- Instalar não exige criar conta em serviço nenhum além da VPS.
- Nenhuma cota de terceiros entre a chamada e o banco.
- Os dados das chamadas ficam na máquina de quem instalou.
- Uma dependência a menos: banco e fila são o mesmo serviço.

**Custos:**

- **O backup é responsabilidade do operador.** O instalador traz backup e restauração, e a
  restauração confere contagens antes de dizer que terminou. Guardar a cópia fora da máquina é
  decisão de quem opera.
- **O banco divide memória e disco com o resto.** Numa VPS pequena, isso define o teto de uso.
- **Não há painel de banco pronto**, como o do Supabase. O que o operador precisa ver, ele vê no
  painel do DeskVoice.

**Supabase como opção:** fica previsto como alternativa documentada para quem preferir um banco
externo. Esse guia ainda não foi escrito, e o caminho não é testado no CI. Enquanto não for,
trate como não suportado.
