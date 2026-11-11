<div align="center">

[Português](README.md) · [English](README.en.md) · Español

# DeskVoice

**Central telefónica open source operada por agentes de IA, instalada en tu VPS.**

El agente atiende la llamada, ejecuta herramientas durante la conversación, pide aprobación a
una persona cuando hace falta, transfiere y deja tareas en marcha después de que la llamada
termina.

[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Instalación propia](https://img.shields.io/badge/instalaci%C3%B3n-en%20tu%20VPS-orange)](install/install.sh)

[Visión](VISION.md) · [Arquitectura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contribuir](CONTRIBUTING.md)

</div>

---

> **Estado del proyecto: una base en construcción.** Lo que está listo, lo que es experimental y
> lo que todavía es un plan están separados en "Qué hace hoy". Nada del roadmap tiene fecha
> prometida.
>
> Esta página es una traducción de [`README.md`](README.md). La mayor parte de la documentación
> de fondo está escrita en portugués de Brasil. Las traducciones son un frente abierto del
> roadmap.

## Instalar

### En tu VPS

Entra en el servidor por SSH y ejecuta:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh
```

El instalador revisa la máquina y la red, hace pocas preguntas (dominio, nombre de la empresa,
tu nombre, correo y contraseña), genera todos los secretos, levanta los servicios, crea el
primer usuario y muestra la dirección del panel. Si falta Docker, pregunta y lo instala. No
editas variables de entorno a mano. Ejecutarlo de nuevo no rompe nada.

A partir de ahí, todo se configura desde la pantalla: el troncal SIP, el número, la clave de IA
y el agente. Ninguna función exige SSH para activarse.

| Qué necesitas | Observación |
|---|---|
| Una VPS con Ubuntu 22.04 o más nuevo | Recomendamos [HostGator](https://www.hostgator.com.br/52708-141-3-52.html), socia de infraestructura del proyecto (enlace de socio). Cualquier VPS con Docker sirve, con el mismo comando. Se recomiendan 2 GB de memoria o más |
| Un dominio apuntando a la VPS | Opcional para probar. Sin dominio, el panel abre por IP y sin HTTPS |
| Un troncal SIP con un número | Contratado con la operadora de telefonía que elijas. Autenticación por registro o por IP |
| Una clave de IA de voz | Gemini (Google) u OpenAI. Pagas el uso directamente al proveedor |

### Ver una llamada sin clave ni troncal

El repositorio trae un motor de voz simulado. Ejecuta una llamada completa, con saludo,
herramienta, pedido de aprobación, transferencia y tarea posterior, sin clave de IA y sin
operadora. En tu computadora:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # requiere Docker: levanta un Postgres desechable y lo elimina al salir
```

## Qué hace hoy

DeskVoice es una base recién lanzada. Para que nadie lo instale esperando lo que todavía no se
probó, cada capacidad dice hasta dónde llegó la prueba:

- **Probado en simulación:** cubierto por una prueba de punta a punta con el motor simulado, que
  recorre la llamada completa sin operador y sin clave.
- **Esperando prueba real:** implementado y probado contra servidores falsos y contra un Asterisk
  real, pero todavía sin una llamada hecha por un operador real.

| Capacidad | Hasta dónde se probó |
|---|---|
| Conversación de la llamada: saludo, turnos, herramientas, cierre | Probado en simulación |
| Avisar a una persona y pedir aprobación en medio de la llamada, con plazo y respuesta por defecto | Probado en simulación |
| Línea de tiempo de cada llamada, evento por evento, con costo | Probado en simulación |
| Tareas que siguen después de la llamada (resumen, avisos, tareas de seguimiento) | Probado en simulación |
| Tope de costo y de duración por llamada | Probado en simulación |
| Panel web en portugués, inglés y español | Rutas probadas con base de datos real; pantallas revisadas en portugués |
| Atender una llamada entrante por una línea de operador (troncal SIP) | Esperando prueba real |
| Transferir la llamada a una persona | Esperando prueba real (el camino en Asterisk se verificó, sin operador) |
| Motores de voz Gemini Live y OpenAI Realtime | Esperando prueba real (probados contra servidor falso, sin clave) |
| Enviar WhatsApp durante la llamada, por conector | Esperando prueba real |
| Instalador, actualización, chequeo de salud, respaldo y restauración | Probados con Docker simulado; respaldo y restauración revisados a mano en un Postgres real; instalación en VPS esperando prueba real |
| Llamadas hechas por el agente | Esperando prueba real, y apagado de fábrica. Ver "Llamadas salientes" |

Si usted hace la primera llamada real, cuente cómo fue en un issue: es la contribución más
valiosa en este momento.

Lo que **no** existe todavía: grabación de audio (la base guarda la transcripción), varias
empresas en la misma pantalla, constructor visual de flujos, llamadas por WhatsApp, IVR por voz,
colas de atención. Parte de esto está en el [roadmap](ROADMAP.md), abierto a la comunidad.

## Cómo funciona

```
        troncal SIP (operadora)
               │ SIP + RTP (UDP)
        ┌──────▼──────┐
        │  Asterisk   │  borde de telefonía; nunca habla HTTP con internet
        └──┬───────┬──┘
   ARI (WS)│       │AudioSocket (TCP, PCM16 8 kHz)
        ┌──▼───────▼──┐        ┌──────────────────┐
        │  apps/voice │◄──────►│ motor de voz     │ Gemini Live / OpenAI Realtime / simulado
        │             │        └──────────────────┘
        │ herramientas│──► avisar a una persona, pedir aprobación, transferir, webhook, WhatsApp
        └──────┬──────┘
               │ eventos + tareas
        ┌──────▼──────┐   LISTEN/NOTIFY   ┌──────────────┐
        │  Postgres   │◄─────────────────►│ apps/routines │ tareas posteriores a la llamada
        └──────▲──────┘                   └──────────────┘
               │
        ┌──────┴──────┐
        │  apps/panel │  Next.js: panel + API; publicado por Caddy
        └─────────────┘
```

La operadora entrega la llamada a Asterisk. Asterisk pasa el control y el audio al proceso de
voz, que conversa con el modelo de IA y ejecuta las herramientas que el agente pide. Todo lo que
ocurre se convierte en un evento en Postgres, y con esos eventos el panel arma la línea de
tiempo. Cuando la llamada termina, un tercer proceso continúa el trabajo.

Stack: Node 22, TypeScript, pnpm, Next.js, Postgres 17 dentro de la VPS, Asterisk 20, Docker
Compose y Caddy. El recorrido de una llamada, paso a paso, está en
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Relación con DeskcommCRM

DeskVoice es hermano de [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM), del mismo
creador.

- **DeskcommCRM ya tiene un módulo de llamadas, y sigue existiendo.** La meta pública de las
  500 estrellas se cumplió allí.
- **DeskVoice es un sistema independiente en el que la telefonía es el centro.** No necesitas
  Deskcomm para usar DeskVoice, ni al revés.
- **Más adelante, el módulo de Deskcomm se convierte en un conector hacia DeskVoice.** Es
  roadmap, sin fecha.

El motivo está en
[`docs/decisions/0001-fronteira-com-o-deskcomm.md`](docs/decisions/0001-fronteira-com-o-deskcomm.md).

## Costos

El software es gratuito. No existe versión de pago ni función bloqueada. Pagas tres cosas, todas
directamente al proveedor:

1. **La VPS.**
2. **La telefonía.** Depende del troncal que contrates.
3. **La IA de voz.** En los motores de voz directa, la estimación ronda unos pocos centavos de
   dólar por minuto, según el modelo.

Son estimaciones, y los precios cambian. El panel muestra el costo medido de cada llamada, y
cada agente tiene un tope de costo por llamada. Ver
[`docs/guides/custos.md`](docs/guides/custos.md).

## Llamadas salientes

El agente puede hacer llamadas. **La función viene desactivada.** El dueño de la instalación la
activa desde la pantalla, después de declarar la finalidad, y a partir de ahí rigen:

- tope diario de llamadas por línea;
- lista de no llamar;
- franja horaria;
- límite de intentos por persona;
- aviso de grabación al inicio de la llamada.

El motivo: en Brasil, el regulador (Anatel) bloquea líneas con patrón de llamadas cortas en
masa, y la regulación de telemarketing está cambiando. DeskVoice no fue hecho para llamadas
masivas y no acepta contribuciones que las faciliten. Quien opera la instalación responde por el
uso que le da. Si operas fuera de Brasil, revisa las reglas de tu país. Ver
[`docs/guides/conformidade-brasil.md`](docs/guides/conformidade-brasil.md).

## Contribuir

El proyecto está armado para que un primer PR salga bien:

- Abre el repositorio en tu asistente de código (Claude Code, Codex, Cursor, Antigravity). Las
  skills en `.agents/skills/` guían la contribución, y [`AGENTS.md`](AGENTS.md) es la autoridad
  que todos leen.
- Herramienta, motor de voz y rutina viven cada uno en su propio archivo y se descubren por
  carpeta. Tu PR no disputa una lista central con el PR de otra persona.
- Cuando el CI queda en rojo, dice si la causa es tu PR.

Empieza por [`CONTRIBUTING.md`](CONTRIBUTING.md) (en portugués) o
[`CONTRIBUTING.en.md`](CONTRIBUTING.en.md) (en inglés).

## Roadmap

El horizonte y los frentes abiertos a la comunidad, cada uno con tamaño y punto de entrada en el
código, están en [`ROADMAP.md`](ROADMAP.md).

## Quién lo construye

DeskVoice fue creado por Rafael Melgaço ([@melgarafael](https://www.youtube.com/@melgarafael)) y
se construye en público, con la comunidad. DeskcommCRM, de donde viene la forma de contribuir
usada aquí, recibió PRs de más de 250 personas.

El crédito es regla, no cortesía: quien contribuye conserva la autoría de sus commits y aparece
con su nombre en las notas de la versión. Lo que este proyecto debe a otros proyectos está en
[`CREDITS.md`](CREDITS.md). Quién decide qué está en [`GOVERNANCE.md`](GOVERNANCE.md).

## Licencia

[MIT](LICENSE). © 2026 Rafael Melgaço y contribuidores.

Asterisk, usado como servicio aparte en el borde de telefonía, es distribuido por sus autores
bajo GPLv2 y no está incorporado en el código de DeskVoice.

## Soporte y responsabilidades

- **Dudas e ideas:** [GitHub Discussions](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions).
- **Errores:** [abre un issue](https://github.com/DeskLabs-OpenSource/DeskVoice/issues).
- **Vulnerabilidades:** reporte privado, como se describe en [`SECURITY.md`](SECURITY.md). Nunca en un issue público.

Lo que es tuyo, por ser una instalación propia:

- **La VPS y los datos.** Firewall, actualizaciones del sistema y copias fuera de la máquina
  corren por tu cuenta.
- **Las claves y los contratos.** Las cuentas con el proveedor de IA y con la operadora son
  tuyas, y las facturas también.
- **El uso.** La grabación, los datos personales y las llamadas salientes tienen reglas legales.
  El proyecto entrega los controles y no ofrece asesoría jurídica.

El software se entrega tal cual, sin garantía, en los términos de la licencia MIT.
