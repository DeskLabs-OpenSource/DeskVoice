#!/usr/bin/env bash
# Decisões de rede: NAT, portas em uso, quem publica o painel.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR

equal "IP público igual ao da placa: direto" direct "$(nat_status 203.0.113.10 203.0.113.10)"
equal "IP público diferente do da placa: NAT" nat "$(nat_status 203.0.113.10 10.0.0.5)"
equal "sem IP da placa: desconhecido" unknown "$(nat_status 203.0.113.10 "")"
equal "sem IP público: desconhecido" unknown "$(nat_status "" 10.0.0.5)"
echo 10.0.0.5 > "$FAKE_DIR/iface_ip"
equal "lê o IP da placa pela rota" 10.0.0.5 "$(interface_ip)"
equal "descobre o IP público" 203.0.113.10 "$(discover_public_ip)"
echo "<html>erro</html>" > "$FAKE_DIR/public_ip"
equal "resposta que não é IP é descartada" "" "$(discover_public_ip)"

ss_udp='UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*
UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*
UNCONN 0 0 [::]:10050 [::]:*
UNCONN 0 0 0.0.0.0:10050 0.0.0.0:* users:(("docker-proxy",pid=1,fd=4))'
equal "lê as portas do ss, sem repetir" "53 5060 10050 " "$(printf '%s\n' "$ss_udp" | ports_from_ss | tr '\n' ' ')"
equal "acha porta ocupada dentro da faixa de áudio" "10050 " "$(printf '%s\n' "$ss_udp" | ports_from_ss | busy_in_range 10000 10200 | tr '\n' ' ')"
equal "faixa livre não acusa nada" "" "$(printf '%s\n' "$ss_udp" | ports_from_ss | busy_in_range 20000 20200)"
equal "saída vazia do ss: nenhuma porta" "" "$(printf '' | ports_from_ss)"

equal "80 e 443 livres: nosso Caddy" caddy "$(decide_proxy_mode 0 0 0)"
equal "80 ocupada por outro: proxy externo" external "$(decide_proxy_mode 1 0 0)"
equal "443 ocupada por outro: proxy externo" external "$(decide_proxy_mode 0 1 0)"
equal "as duas ocupadas por outro: proxy externo" external "$(decide_proxy_mode 1 1 0)"
equal "ocupadas pelo nosso Caddy (reinstalação): continua Caddy" caddy "$(decide_proxy_mode 1 1 1)"
equal "porta local livre: a primeira candidata" 3080 "$(printf '80\n443\n' | pick_free_port 3080)"
equal "porta local ocupada: pula para a próxima livre" 3082 "$(printf '80\n3080\n3081\n' | pick_free_port 3080)"

check "outro provedor conhecido: mostra a parceira" partner_hint_allowed "DigitalOcean"
check "outro provedor conhecido: mostra a parceira (EC2)" partner_hint_allowed "Amazon EC2"
refuse "fabricante genérico: na dúvida não mostra" partner_hint_allowed "QEMU"
refuse "fabricante vazio: não mostra" partner_hint_allowed ""
refuse "HostGator: não mostra" partner_hint_allowed "HostGator"
finish
