---
impact: nothing_changes
section: changed
title: Apagar uma organização no banco leva junto todas as linhas dela
---

Toda chave estrangeira para a organização passa a apagar em cascata, menos duas que ficam vazias de propósito: o registro da instalação guarda a própria exclusão, e a conta só deixa de lembrar o último vínculo. Ainda não há como excluir organização pelo painel; esta mudança só prepara o banco, e ninguém vê diferença. Um teste gerado do catálogo reprova a tabela nova que nascer sem cascata. Crédito: @melgarafael.
