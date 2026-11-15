---
impact: new_capability
section: added
title: O agente pode guardar notas sobre quem ligou, com prazo, exportação e apagamento
---

A ferramenta nova `remember_caller_note` deixa o agente anotar o que a pessoa disse e importa para a
próxima ligação ("prefere de manhã", "o pedido é o 4471"). Ela vem desligada: nada muda até alguém
marcá-la na tela do agente, e o agente de exemplo não nasce com ela. A nota guarda o telefone da
própria ligação, nunca um número dito pelo modelo; a ligação sem número não anota, e cada ligação
guarda no máximo 10 notas de até 300 caracteres. A equipe vê as notas no bloco "Este número" da tela
da chamada, cada uma com o link da ligação em que nasceu; o agente ainda não as recebe, e nenhuma
nota entra em aviso, evento ou na linha do tempo. As notas saem sozinhas pelo prazo da memória, de
90 dias se ninguém escolher outro, ajustável de 30 a 365 dias no bloco novo "Memória entre chamadas",
em Configurações (só dono ou administrador), e nunca duram mais que o prazo de guarda das conversas.
A exportação dos dados de um telefone passa a trazer as notas dele, e o apagamento a pedido de quem
ligou as apaga e as conta na prévia e no recibo. Crédito: @melgarafael.
