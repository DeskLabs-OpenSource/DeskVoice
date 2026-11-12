---
impact: nothing_changes
section: fixed
title: A atualização deixa de acumular no disco as imagens das versões antigas
---

Cada atualização deixava no servidor as imagens da versão anterior a ela, cerca de 2 GB por
versão. Agora, depois que tudo responde, a atualização remove as imagens do DeskVoice que não
são nem a versão nova nem a de onde se acabou de sair, que fica para voltar a ela sem internet,
e diz quais removeu. A imagem construída no próprio servidor (`local`) sai quando a instalação
passa a rodar a imagem publicada; quem instalou com `--build` e segue assim não perde nada.
Imagem que algum contêiner ainda usa fica, com um aviso, e as imagens de terceiros (banco,
telefonia, entrada, WhatsApp) não são tocadas. Quem limpa é o atualizador da versão nova, então
a limpeza já acontece na atualização que leva a esta versão. Nada a fazer em instalações
existentes. Crédito: @melgarafael.
