---
impact: nothing_changes
section: changed
title: O painel já sabe o que uma sessão de suporte da instalação não pode fazer
---

Preparação interna para o acesso de suporte da administração da instalação, que ainda não existe. A sessão do painel passa a saber se é de um vínculo de suporte, e as ações que convidam, mexem na equipe ou na conta, ou criam algo que dura mais que a sessão (convite, aceitar convite, papel e remoção de pessoas, senha, telefone e WhatsApp do perfil, link público da ligação, conector e ganchos, pareamento do WhatsApp, gravar chave de provedor, criar e editar tronco e atendente, a política de ligação de saída, e a área da instalação) respondem que a sessão de suporte não pode fazer isso, com a frase nos três idiomas. Hoje ninguém tem esse vínculo, então nenhuma tela nem rota muda para ninguém, e a atualização não mexe no banco. Toda rota de escrita do painel está numa tabela com a decisão e o motivo, e uma verificação nova no CI reprova a rota nova que não está nela, e a rota marcada como recusada que não recusa. Crédito: @melgarafael.
