# Do zero à primeira ligação

Este guia leva você de nenhuma instalação até um agente atendendo o seu número. São duas
etapas, e a primeira não custa nada:

1. **Ver uma chamada simulada**, no seu computador, sem chave de IA e sem operadora.
2. **Instalar na VPS e atender uma ligação de verdade.**

> O projeto é uma fundação em construção. Se um passo daqui não corresponder ao que você vê na
> tela, o guia está errado: abra uma issue.

## Etapa 1: a chamada simulada

O DeskVoice traz um motor de voz simulado. No lugar de um modelo de IA, ele executa um roteiro:
o agente cumprimenta, a pessoa fala, o agente pede uma aprovação, alguém aprova, a ligação é
transferida e termina. Tudo o que o sistema faria numa chamada real acontece, menos a operadora
e a conta do provedor.

Você precisa de Node 22, pnpm e Docker (a demonstração sobe um Postgres descartável e o remove ao sair).

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # precisa de Docker
```

O que observar:

- **A linha do tempo.** Cada passo da chamada vira um evento: início, atendimento, aviso de
  gravação, falas, ferramenta chamada, pedido de aprovação, decisão, transferência, fim.
- **O humano no meio.** A chamada espera a aprovação e segue depois dela.
- **O custo.** A chamada termina com um custo registrado.
- **O depois.** Uma tarefa de resumo entra na fila quando a ligação acaba.

Se isso faz sentido para o seu caso, vale seguir para a instalação.

## Etapa 2: instalar na VPS

### O que ter em mãos

| Item | Observação |
|---|---|
| Uma VPS com Ubuntu 22.04 ou mais novo | Recomendamos a [HostGator](https://www.hostgator.com.br/52708-141-3-52.html), parceira do projeto (link de parceria). Qualquer VPS com Docker funciona pelo mesmo caminho. Tenha 10 GB de disco livre. Sobre memória, só o que foi medido: a instalação foi provada numa VPS de 8 GB e 4 vCPU, e o DeskVoice parado usa cerca de 400 MB. O menor tamanho em que a instalação cabe ainda não foi medido. As imagens publicadas são para processador x86_64 (amd64); em ARM a instalação constrói na própria máquina, com `--build`. Se faltar o Docker, o instalador pergunta e instala |
| Um domínio apontado para o IP da VPS | Opcional para testar. Sem domínio, o painel abre pelo IP e **sem HTTPS**, o que não serve para uso de verdade |
| Acesso SSH à VPS | O endereço, a porta e a senha que a hospedagem enviou |
| Um tronco SIP com um número | Contratado com uma operadora de telefonia. Você vai precisar do endereço do servidor, do usuário, da senha e de saber se a autenticação é por registro ou por IP |
| Uma chave de IA de voz | Do Gemini (Google) ou da OpenAI |

Sobre a rede: a VPS precisa aceitar conexões nas portas 80 e 443 (painel), na porta 5060 em UDP
(sinalização SIP) e na faixa de portas de áudio, que por padrão vai de 10000 a 10200 em UDP. Se
a hospedagem tiver um firewall no painel dela, libere ali também: isso o instalador não
consegue fazer por você.

### 1. Entre na VPS

No terminal do seu computador:

```bash
ssh -p PORTA root@SEU_IP
```

Troque `PORTA` e `SEU_IP` pelos seus. Ao digitar a senha, nada aparece na tela. É o terminal
escondendo o que você digita, e não um travamento.

### 2. Rode o instalador

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh
```

O instalador trabalha em cinco etapas e diz em qual está:

1. **Confere a máquina:** sistema, memória, disco e Docker.
2. **Confere a rede.** É aqui que ligação fica muda. Ele compara o IP público com o IP da placa
   de rede, confere as portas de telefonia e avisa o que você precisa liberar no painel da
   hospedagem. Se as portas 80 e 443 já estiverem ocupadas por outro proxy, ele não disputa:
   publica o painel numa porta local e mostra, no fim, o que configurar no proxy que já existe.
3. **Faz algumas perguntas:** o domínio do painel, o nome da empresa, o seu nome, o seu e-mail
   (que vira o login) e uma senha de dez caracteres ou mais.
4. **Instala:** gera os segredos, gera a configuração do Asterisk, baixa as imagens da versão
   publicada mais recente e grava o número dela, sobe o banco, aplica a estrutura, cria a
   empresa e o usuário dono e sobe o resto. Enquanto o projeto não tiver uma versão publicada,
   as imagens são construídas na própria VPS, o que leva alguns minutos.
5. **Mostra o endereço do painel** e os próximos passos.

Você não inventa segredo técnico nenhum e não edita arquivo de configuração. Rodar o instalador
de novo não quebra nada: ele retoma de onde parou e não troca um segredo que já existe.

Quer ver o que ele faria antes de deixar que faça? `bash install/install.sh --dry-run` mostra o
plano sem alterar nada.

### 3. Entre no painel

Abra o endereço que o instalador mostrou e entre com o e-mail e a senha que você definiu.

### 4. Informe a chave de IA

Em Configurações, no motor de voz, cole a chave do Gemini ou da OpenAI. Ela é guardada cifrada.

### 5. Cadastre a linha

Na tela Linha, informe os dados do tronco e o número que a operadora passou. O painel gera a
configuração do Asterisk a partir do formulário. Não há passo por SSH.

Use a verificação do tronco, na mesma tela. Ela diz se a central conseguiu falar com a
operadora e, se não conseguiu, qual foi o erro.

### 6. Crie o agente

Na tela de agentes, defina:

- **o nome e o papel** do agente;
- **as instruções:** quem ele é, o que resolve, o que não resolve e quando chama um humano;
- **a saudação:** a primeira frase que quem liga ouve;
- **o motor de voz;**
- **as ferramentas** que ele pode usar;
- **os limites:** duração máxima da chamada e teto de custo por chamada;
- **o número de transferência:** para onde a ligação vai quando precisa de uma pessoa.

Comece pequeno. Um agente que faz uma coisa bem e transfere o resto vale mais do que um agente
que tenta tudo.

### 7. Ligue o número ao agente

Na tela Linha, aponte o número para o agente.

### 8. Ligue

Do seu celular, ligue para o número. Enquanto fala, deixe aberta a tela Chamadas: a ligação
aparece ao vivo. Ao desligar, abra a linha do tempo e confira as falas, as ferramentas, o custo
e o resumo.

## Se a primeira ligação não der certo

A checagem de saúde separa os problemas. Ela nunca resume tudo em um "ok": responde, uma a uma,
se o painel está no ar, se o banco está no ar, se o Asterisk está no ar, se o tronco está
registrado e se o motor de voz está configurado.

| O que acontece | Onde olhar primeiro |
|---|---|
| A ligação não completa, ou dá ocupado | O tronco. Use a verificação na tela de linha telefônica. Confira usuário, senha e modo de autenticação com a operadora |
| A ligação completa e fica muda | Rede. Quase sempre é o áudio (RTP) que não chega: firewall da hospedagem ou diferença entre endereço público e endereço da interface |
| A ligação é recusada logo no início | O motor de voz. A linha do tempo mostra a recusa com o motivo. Em geral, é chave ausente ou inválida |
| O agente atende e para de falar no meio | A linha do tempo mostra a falha do motor. Confira a conta e o limite de uso no provedor de IA |
| O agente fala e não executa o que deveria | As instruções e a lista de ferramentas do agente. A linha do tempo mostra o que ele tentou chamar |

Para instalar ou diagnosticar com ajuda de um assistente de código, abra o repositório nele e
peça pelo assunto. As skills `deskvoice-instalar` e `deskvoice-operar` carregam o roteiro.

## Depois da primeira ligação

- Entenda a sua conta: [custos](custos.md).
- **Não ligue o recurso de ligações de saída** antes de ler
  [conformidade no Brasil](conformidade-brasil.md).
- Faça um backup e guarde uma cópia fora da VPS.
- Quer que o agente consulte um sistema seu? Veja
  [adicionar uma ferramenta](adicionar-uma-ferramenta.md).
