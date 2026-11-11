#!/usr/bin/env bash
# Validadores: as guardas que impedem a instalação de seguir com um dado errado.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR

for v in voce@empresa.com.br a.b+c@sub.dominio.io x_y@d-ominio.co; do check "e-mail válido: $v" valid_email "$v"; done
for v in "" sem-arroba.com a@b "a b@c.com" a@@b.com .a@b.com a..b@c.com a@b..com "a@b.com." a@.com; do refuse "e-mail inválido: '$v'" valid_email "$v"; done

for v in voz.empresa.com.br exemplo.com a-b.exemplo.io xn--80ak6aa92e.com; do check "domínio válido: $v" valid_domain "$v"; done
for v in "" localhost https://voz.com voz.com/painel voz.com:8080 "voz .com" Voz.Empresa.com -a.com a-.com 203.0.113.10 a..com voz.c; do refuse "domínio inválido: '$v'" valid_domain "$v"; done
contains "domínio com https explica o conserto" "$(valid_domain https://voz.com)" "sem http"
contains "IP no lugar de domínio explica o conserto" "$(valid_domain 203.0.113.10)" "deixe o domínio vazio"

for v in "senha-boa-123" "frase com espaco no meio" "0123456789a"; do check "senha válida" valid_password "$v"; done
for v in "" curta "123456789" "1234567890" " comeca-com-espaco" "termina-com-espaco " "tem	tab-no-meio"; do refuse "senha inválida: '$v'" valid_password "$v"; done
refuse "senha com mais de 128 caracteres" valid_password "$(printf 'a%.0s' $(seq 1 129))"

for v in 203.0.113.10 0.0.0.0 255.255.255.255 10.0.0.1; do check "IP válido: $v" valid_ipv4 "$v"; done
for v in "" 256.1.1.1 1.2.3 1.2.3.4.5 a.b.c.d 01.2.3.4 "1.2.3.4 " 1.2.3.-4 ::1; do refuse "IP inválido: '$v'" valid_ipv4 "$v"; done
for v in 10.1.2.3 192.168.0.5 172.16.0.1 172.31.255.1 127.0.0.1 100.64.0.1 169.254.1.1; do check "IP interno: $v" is_private_ipv4 "$v"; done
for v in 203.0.113.10 172.32.0.1 172.15.0.1 100.128.0.1 8.8.8.8; do refuse "IP público: $v" is_private_ipv4 "$v"; done

for v in 1 80 5060 65535 08080; do check "porta válida: $v" valid_port "$v"; done
for v in "" 0 65536 -1 80a 1.5 999999; do refuse "porta inválida: '$v'" valid_port "$v"; done

check "nome válido" valid_name "Clínica São José"
for v in "" " " " Ana" "Ana " "$(printf 'a%.0s' $(seq 1 81))" "linha$(printf '\n')quebrada$(printf '\t')x"; do refuse "nome inválido: '$v'" valid_name "$v"; done

check "Ubuntu 22.04" os_supported ubuntu 22.04
check "Ubuntu 24.04" os_supported ubuntu 24.04
check "Debian 12" os_supported debian 12
refuse "Ubuntu 20.04" os_supported ubuntu 20.04
refuse "Debian 11" os_supported debian 11
refuse "CentOS" os_supported centos 9
refuse "sem os-release" os_supported "" ""
for v in x86_64 amd64 aarch64 arm64; do check "arquitetura $v" arch_supported "$v"; done
for v in armv7l i686 riscv64 ""; do refuse "arquitetura '$v'" arch_supported "$v"; done
finish
