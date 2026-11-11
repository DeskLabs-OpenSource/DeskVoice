<!--
  Abrindo de um FORK? Você está no lugar certo. PR de fork para cá é exatamente como se contribui.
  Não feche o seu por achar que errou o repositório: nós respondemos em até 3 dias úteis.
-->

## O que este PR faz

<!-- 1 a 3 frases, do ponto de vista de quem USA o DeskVoice. Se resolve uma issue: Closes #123 -->

## Como foi provado

<!-- Comandos que você rodou e o que viu. Ex.: rodapé do `pnpm verify`; "tirei a linha do conserto
     e o teste X ficou vermelho"; captura da tela. Diga também o que NÃO conseguiu medir. -->

---

### Isto é trabalho nosso

Se algum destes faltar, não é pendência sua. Faça o que der e diga o que ficou.

| | |
|---|---|
| **Fragmento em `.changes/`** | É a nota que o dono de uma instalação lê antes de atualizar. Se faltar, nós escrevemos, com o seu crédito. |
| **Conflito com a `main`** | Nós resolvemos, preservando os seus commits. Deixe "Allow edits by maintainers" ligado. |
| **Carimbo de migration** | Se colidir com outro PR aberto que você não tinha como ver, quem renomeia somos nós. |
| **Workflows parados no primeiro PR** | O GitHub segura até um mantenedor liberar. Não é erro seu. |

### O CI confere

`pnpm verify` roda o mesmo na sua máquina. O único check exigido é o `ready`.

- [ ] `pnpm verify` verde (lint, tipos, cercas, testes)
- [ ] `pnpm test:db` verde, se mexi em banco

### O CI não vê

- [ ] A mudança tem teste que fica vermelho sem ela
- [ ] O que acontece aparece na linha do tempo da chamada, e nenhuma falha termina em silêncio ao telefone
- [ ] Não exige SSH nem variável de ambiente nova para funcionar numa instalação existente
- [ ] Se quem já instalou precisa fazer algo, está dito acima

<sub>Contrato completo: [`AGENTS.md`](../AGENTS.md). Com assistente de código, peça a skill `deskvoice-contribuir`.</sub>
