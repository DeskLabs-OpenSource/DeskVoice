# Atualizar o DeskVoice

Há dois caminhos, e os dois fazem a mesma coisa no servidor: backup conferido, troca de versão,
mudanças no banco, conferência de saúde e volta sozinha para a versão anterior se a nova não
responder. O sistema fica fora do ar por alguns minutos e **as chamadas em andamento caem**.
Escolha um horário sem ligações.

Antes de atualizar, leia as notas da versão. Se houver um bloco "Requer atenção", há algo que
você precisa fazer antes ou logo depois.

## Pela tela

Em **Configurações → Versão e atualização**:

1. A tela mostra a versão **em execução** (lida do próprio painel, na hora), a **mais recente
   publicada** e as notas das versões entre a instalada e aquela para a qual o servidor iria.
2. O dono ou um administrador clica em **Atualizar** e confirma com a própria senha. A
   confirmação diz de qual versão para qual. A versão nomeada é a que o servidor anunciou: é
   para ela, e só para ela, que a atualização vai.
3. Em até um minuto o agente do servidor começa. O painel sai do ar durante a troca; a tela
   volta sozinha.
4. No fim, a tela diz o resultado: atualizou, não havia o que atualizar, **não foi aplicada**
   (o servidor segue na versão anterior, respondendo) ou **falhou**. Nos dois últimos casos, a
   saída do atualizador fica na tela, sem senhas.

Operador vê o bloco e não pode pedir.

### O que a tela pode mostrar no lugar do botão

| A tela diz | O que é | O que fazer |
|---|---|---|
| O agente de atualização ainda não falou com o painel | O agente não está instalado neste servidor. É o caso de quem atualizou a partir da 0.1.0, que não tinha agente | No servidor, na pasta do DeskVoice: `bash install/update.sh` (ou `sudo bash install/agent.sh --install`). Não atualiza nada: instala o agente |
| O agente não está respondendo desde ... | O agente parou de passar, ou não consegue falar com o painel | Veja `deploy/agent/agent.log` no servidor. O botão continua: um pedido feito assim espera o agente e vence em 15 minutos |
| Este servidor roda a versão "local" | As imagens foram construídas no servidor (`--build`, ou processador ARM) | Atualize pelo terminal: `git pull && bash install/install.sh --build` |
| Não foi possível consultar as versões publicadas | O painel não alcançou a lista pública de versões | A versão em execução continua certa. Sem as notas a tela não oferece o botão; a consulta é refeita em um minuto. Pelo terminal dá para atualizar |
| A versão já existe, mas as notas ainda não estão disponíveis | O servidor já enxerga uma versão nova, e a página dela ainda não foi publicada (ou a consulta falhou) | Espere alguns minutos. O botão aparece quando as notas puderem ser lidas: ninguém confirma sem ver o que muda |
| O pedido não foi executado: saiu uma versão mais nova | Entre a sua confirmação e a execução saiu outra versão. O servidor não atualiza para uma versão que ninguém confirmou | Nada foi alterado. Leia as notas da versão nova e peça de novo |
| O pedido venceu | O agente não pegou o pedido em 15 minutos, ou começou e não devolveu resultado em 30 | Nada fica travado: outro pedido já pode ser feito. Se venceu depois de começar, confira antes `bash install/healthcheck.sh` |

### Como funciona, e por quê

O painel roda em contêiner e **não tem acesso ao Docker do servidor**. Ele só registra o pedido.
Quem atualiza é o agente (`install/agent.sh`), que o instalador agenda para passar a cada
minuto. A cada passada o agente anuncia a versão instalada e lê do painel **um sim ou um não**.
Nunca um comando e nunca um número de versão: para qual versão ir, o servidor decide pelas
versões publicadas no repositório, e **avisa o painel antes**, para a tela mostrar exatamente
a versão que seria instalada. O pedido guarda a versão que você confirmou; se na hora de
executar o servidor já enxergar outra, o painel encerra o pedido e responde "não".

A versão mais recente e as notas vêm da lista pública de releases do projeto no GitHub. A
consulta é a mesma para todo mundo: não leva versão, endereço nem identificador da sua
instalação. O GitHub vê o IP do servidor, como em qualquer acesso.

A decisão e as alternativas descartadas estão em
[`0010-atualizar-pela-tela.md`](../decisions/0010-atualizar-pela-tela.md).

## Pelo terminal

```bash
bash install/update.sh              # vai para a versão publicada mais recente
bash install/update.sh --to 0.3.0   # ou para uma versão específica
```

É o mesmo atualizador que a tela aciona. Os problemas mais comuns e o que fazer estão em
[`install/README.md`](../../install/README.md).

## Quem está na 0.1.0

A 0.1.0 não tem o agente, então a primeira atualização é pelo terminal, como sempre foi. O
atualizador que roda nessa vez ainda é o da 0.1.0, que não conhece o agente. Por isso, depois
dela, rode o atualizador **mais uma vez**:

```bash
bash install/update.sh   # 1ª vez: atualiza
bash install/update.sh   # 2ª vez: nada a atualizar; instala o agente e entrega o segredo dele ao painel
```

Na segunda vez o painel reinicia (alguns segundos). Dali em diante, a atualização é pela tela.
