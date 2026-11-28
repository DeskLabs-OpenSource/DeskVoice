# Ligar um servidor de ferramentas (MCP)

Um servidor MCP oferece ferramentas que o agente pode usar. A ferramenta **vem de fora**: quem a
escreve e a mantém é o dono do servidor, não o DeskVoice. O DeskVoice só deixa rodar o que você
marcou, e guarda um retrato do que o servidor oferecia quando você marcou.

**A ligação ainda não oferece essas ferramentas ao agente:** o que se marca fica gravado para
quando ela oferecer, e nenhuma ligação muda por isso.

A seção fica em **Configurações → Integrações**, abaixo dos webhooks, e só quem administra a
organização a altera.

## 1. Cadastrar

Em **Servidores de ferramentas (MCP)**, clique em **Cadastrar servidor** e preencha:

- **Identificador:** de 1 a 16 letras minúsculas ou números. Vai no nome de cada ferramenta e não
  muda depois.
- **Nome:** como o servidor aparece na tela.
- **Endereço:** o endereço do servidor. **Cadastre o endereço final.** Se o
  servidor pedir outro endereço, a tela mostra qual é: cadastre esse. Endereço de rede privada é
  recusado.
- **Cabeçalho do segredo** e **Segredo:** só se o servidor pede uma chave. O cabeçalho padrão é
  `Authorization`. O segredo fica guardado cifrado e não volta à tela: ela mostra só "Segredo
  configurado". Trocar o endereço apaga o segredo guardado, e você digita de novo.
- **Prazo (s):** quanto tempo o DeskVoice espera o servidor responder. O padrão é 10 s, e vai de
  1 a 30 s. Servidor lento pode precisar de um prazo maior.

## 2. Buscar

Clique em **Buscar ferramentas**. O DeskVoice pergunta ao servidor o que ele oferece e mostra a
lista em **Ferramentas do servidor**.

- Ferramenta cujos campos o DeskVoice não entende aparece, mas não pode ser liberada.
- Se o servidor oferece mais ferramentas do que o DeskVoice guarda, a tela avisa quantas ficaram
  de fora.
- **Buscar de novo** compara com o retrato anterior: cada ferramenta aparece como nova, como
  "mudou: confira e marque de novo" ou como "sumiu do servidor". **Ferramenta que muda no servidor
  volta desmarcada**, porque o que você aprovou não é mais o que ela é.

## 3. Marcar

Para cada ferramenta:

- **Liberar para os agentes:** sem esta marca, nenhum agente a vê.
- **Escreve (muda algo fora do DeskVoice):** marque se a ferramenta grava, envia ou apaga alguma
  coisa. O servidor pode dizer que a ferramenta só lê, mas isso é só uma dica: quem decide é você.

Clique em **Salvar servidor**. Depois, na tela de cada agente, as ferramentas liberadas aparecem
como caixas, agrupadas por servidor ("Do servidor …") e **desmarcadas**: marque as que esse agente
pode usar.

## 4. Aprovação

Cada ferramenta tem também a caixa **Pedir aprovação de uma pessoa antes de cada uso**,
desmarcada de fábrica. Com ela marcada:

- antes de cada uso, a ferramenta espera a decisão de alguém da equipe, em **Aprovações**;
- a pergunta leva os dados que vão ser enviados ao servidor, cortados em 1.000 caracteres;
- quem liga espera na linha por até 2 minutos;
- sem resposta, vale o que está em **Configurações → Regras das ligações → Pedido de aprovação sem
  resposta**. De fábrica é **negar**. Com "Aprovar por omissão", a ferramenta roda sem ninguém ter
  aprovado.

## Limites

- **Resposta:** a resposta de uma ferramenta acima de 16 KiB é recusada. Prefira ferramentas que
  devolvem pouco texto.
- **Prazo:** o servidor que não responde dentro do prazo do cadastro (padrão de 10 s, teto de 30 s)
  é tratado como falha.

## Descadastrar

**Descadastrar** pede para digitar o identificador do servidor. Ao confirmar, as ferramentas dele
saem de todo agente que as usa, e o segredo é apagado.
