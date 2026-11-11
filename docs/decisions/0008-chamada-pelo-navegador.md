# 0008: Chamada pelo navegador

- **Estado:** aceita
- **Data:** 2026-11-11
- **Quem decidiu:** o dono pediu a capacidade (conversar com o agente pelo painel, sem linha telefônica). As escolhas abaixo são do construtor e ficam abertas à revisão dele.

## Contexto

Aprovar um número de telefone leva dias. Sem ele, quem instala não tinha como ouvir o agente, só a chamada simulada, que segue um roteiro. Faltava um jeito de conversar de verdade antes de ter linha.

## Decisão

- **É uma chamada como as outras.** Mesma sessão, ferramentas, aviso de gravação, aprovação humana, teto de custo e de duração, resumo pós-chamada. Só o transporte muda: o áudio chega por WebSocket em vez de vir do Asterisk. Entra no histórico com `channel: "web"`.
- **Qualquer papel com sessão pode iniciar,** inclusive o operador. Quem atende precisa poder ouvir o agente que opera. O gasto é limitado pelos tetos abaixo, e não pelo papel.
- **Entrada por token de uso único.** O painel pede a chamada em nome de uma sessão autenticada; o processo de voz devolve um token de 32 bytes, válido por 60 s, guardado só em memória e preso àquela chamada. O WebSocket aceita qualquer origem, porque não usa cookie: o que protege é o token.
- **Teto de três chamadas pelo navegador ao mesmo tempo por organização,** contando as que esperam a conexão. Cada chamada já tinha teto de custo; sem este, o gasto somado não tinha limite.
- **Agente no motor simulado é recusado antes de abrir o microfone,** com a orientação de trocar o motor.
- **A porta de voz nunca é exposta direto na internet.** Com o Caddy do DeskVoice, vai pelo caminho `/voice-ws` na mesma origem. Sem ele, fica em `127.0.0.1`, alcançada pelo proxy que já existe ou por túnel SSH.
- **Áudio em 8 kHz,** o mesmo formato da telefonia. É o que a pessoa ouviria numa ligação.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| O navegador falar direto com o provedor de IA | Daria áudio melhor, mas a chamada sairia do caminho comum: ferramentas, aprovação, custo e histórico teriam uma segunda implementação, e só para um provedor |
| Passar o áudio pelas rotas do painel | O painel não mantém conexão de áudio contínua; viraria um repasse lento e frágil |
| Token na primeira mensagem, em vez de no endereço | Evitaria o token em registro de acesso de proxy. Fica como melhoria: o token vale uma vez e por 60 s, então o registro guarda algo já sem valor |
| Restringir a dono e administrador | Quem opera é quem mais precisa testar o agente |

## Consequências

- O navegador só libera o microfone em HTTPS ou em `localhost`. Instalação aberta pelo IP, sem domínio, não consegue usar esta tela sem túnel; a tela e o instalador dizem isso.
- Sem fone de ouvido, o microfone capta a fala do agente e ele se interrompe. A tela recomenda o fone.
- Limites conhecidos: o token aparece na URL do WebSocket; a fila de fala do agente no servidor não tem teto próprio; a checagem de saúde não confere se o proxy encaminha `/voice-ws`.
- Nada disto foi provado com um navegador de verdade nem com um motor real até a data deste registro.
