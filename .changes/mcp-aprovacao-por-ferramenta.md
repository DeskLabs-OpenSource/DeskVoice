---
impact: new_capability
section: added
title: Na seção dos servidores MCP, cada ferramenta pode pedir a aprovação de uma pessoa antes de cada uso
---

Em Configurações → Integrações, na seção "Servidores de ferramentas (MCP)", cada ferramenta ganha a caixa "Pedir aprovação de uma pessoa antes de cada uso", desmarcada de fábrica. Marcada, a ferramenta espera a decisão de alguém da equipe antes de rodar. Enquanto isso, quem liga ouve uma frase de espera no idioma do agente, por até 2 minutos. Sem resposta no prazo, vale o padrão de aprovações da organização, que de fábrica é negar, e nunca o que o agente pedir: com o padrão em aprovar, a ferramenta roda sem ninguém ter aprovado. A pergunta leva o nome da ferramenta, o servidor e os dados que vão ser enviados, cortados em 1.000 caracteres, sem o endereço do servidor. Negada, a ferramenta não chama o servidor. Buscar de novo desmarca a caixa da ferramenta que mudou no servidor. **A ligação ainda não oferece as ferramentas MCP ao agente:** a marca fica gravada para quando ela oferecer, e por enquanto nenhuma ligação pede essa aprovação. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.
