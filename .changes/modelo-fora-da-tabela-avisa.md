---
impact: nothing_changes
section: fixed
title: A tela avisa quando o modelo da classificação gravado não vale por estar fora da tabela de preço
---

Em Configurações → Inteligência artificial, um modelo da classificação gravado sem endpoint e fora da tabela de preço é trocado pelo modelo do motor na hora da classificação, e a tela continuava mostrando o modelo gravado como se valesse. Agora, nesse caso, um aviso ao lado do campo diz que o modelo não está na tabela desta versão, que a classificação usa o do motor, e como resolver. Pelo painel esse estado não se cria, porque o painel recusa salvar um modelo assim. Ele aparece com uma configuração posta por fora do painel ou com um modelo que saia da tabela numa versão futura. Crédito: @melgarafael.
