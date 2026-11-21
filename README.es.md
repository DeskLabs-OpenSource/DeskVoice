<div align="center">

[Português](README.md) · [English](README.en.md) · Español

<h1>
  <a href="https://deskvoice.com.br"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/deskvoice-logo-dark.svg">
    <img src="brand/deskvoice-logo-light.svg" alt="DeskVoice" height="76">
  </picture></a>
</h1>

**Central telefónica open source operada por agentes de IA, instalada en tu VPS.**

El agente atiende la llamada, ejecuta herramientas durante la conversación, pide aprobación a
una persona cuando hace falta, transfiere y deja tareas en marcha después de que la llamada
termina.

**[deskvoice.com.br](https://deskvoice.com.br)** (en portugués) · [Instalar](https://deskvoice.com.br/instalar) · [Guías](https://deskvoice.com.br/guias) · [Notas de versión](https://deskvoice.com.br/changelog)

[![Sitio](https://img.shields.io/badge/sitio-deskvoice.com.br-a2552f)](https://deskvoice.com.br)
[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Instalación propia](https://img.shields.io/badge/instalaci%C3%B3n-en%20tu%20VPS-orange)](install/install.sh)

[Visión](VISION.md) · [Arquitectura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contribuir](CONTRIBUTING.md)

</div>

---

> **Estado del proyecto: con versiones publicadas.** La instalación, la actualización desde
> el panel, el respaldo, la restauración y la vuelta automática de una actualización fallida ya
> corrieron en una VPS real, y un colaborador ya hizo llamadas reales con el motor OpenAI Realtime.
> Lo que está probado, lo que es experimental y lo que todavía es un plan están separados en "Qué
> hace hoy". Nada del roadmap tiene fecha prometida.
>
> Esta página es una traducción de [`README.md`](README.md). La mayor parte de la documentación
> de fondo está escrita en portugués de Brasil. Las traducciones son un frente abierto del
> roadmap.

## Instalar

> **Socio de infraestructura: HostGator.** DeskVoice es gratuito, sin versión de pago y sin
> funciones bloqueadas. Lo que sostiene el proyecto es la alianza con HostGator, y el kit de
> instalación se hizo pensando en su VPS: un comando, pocas preguntas, ninguna variable que editar.
>
> **[Contratar la VPS de HostGator por el enlace de la alianza](https://www.hostgator.com.br/52708-141-3-52.html)**
>
> Usar ese enlace es la forma de apoyar el proyecto. Cualquier otra VPS con Docker funciona con el
> mismo comando, sin ninguna diferencia de funciones.

### En tu VPS

Entra en el servidor por SSH y ejecuta una línea:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash
```

Descarga DeskVoice en `~/DeskVoice` y abre el instalador. ¿Prefieres leer antes de ejecutar? El
mismo resultado, paso a paso:

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
| Una VPS con Ubuntu 22.04 o más nuevo (Debian 12+, AlmaLinux 9+ y Rocky Linux 9+ también se aceptan; lo que se probó en cada uno está en [`install/README.md`](install/README.md#sistemas-aceitos), en portugués) | La [VPS de HostGator](https://www.hostgator.com.br/52708-141-3-52.html), socia del proyecto, es la recomendada. Cualquier VPS con Docker sirve, con el mismo comando. Sobre memoria, solo lo que se midió: la instalación se probó en una VPS de 8 GB y 4 vCPU, y DeskVoice en reposo usa cerca de 380 MiB de memoria y ocupa cerca de 2,7 GB de disco (medido en la 0.3.0, sin WhatsApp). El menor tamaño en el que cabe la instalación todavía no se midió. Las imágenes publicadas son para procesador x86_64 (amd64) y, a partir de la 0.12.0, también para ARM de 64 bits (arm64), con el mismo comando; todavía no hubo prueba en una máquina ARM real ([por qué](docs/decisions/0017-imagens-para-amd64-e-arm64.md)). En ARM, el instalador comprueba si la versión tiene la imagen: si no la tiene, se detiene y lo dice, y la instalación construye en la propia máquina, con `--build` |
| Un dominio apuntando a la VPS | Opcional para probar. Sin dominio no hay HTTPS: el panel queda solo dentro de la VPS y entras por un túnel SSH (el instalador muestra el comando) |
| Un troncal SIP con un número | Contratado con la operadora de telefonía que elijas. Autenticación por registro o por IP; por IP, con una o más direcciones o bloques numéricos de la operadora, hasta /16 en IPv4 y /32 en IPv6 |
| Una clave de IA de voz | Gemini (Google) u OpenAI. Pagas el uso directamente al proveedor |

### Instalar con un asistente de IA

¿Usas Claude Code, Codex, Cursor u otro asistente de código? Pega esto en él:

```text
Ayúdame a instalar DeskVoice: https://github.com/DeskLabs-OpenSource/DeskVoice
Lee el AGENTS.md del repositorio y sigue la skill deskvoice-instalar.
```

Su primera pregunta es si ya tienes un servidor. Si no lo tienes, te dice qué tamaño de máquina
alcanza y muestra el enlace de la VPS de HostGator, el mismo del bloque de arriba, aclarando que
es un enlace de la alianza y que cualquier otra VPS con Docker funciona igual. Después pregunta
por el sistema de la VPS, los puertos, el dominio, el troncal SIP y la clave de IA, y te acompaña
hasta la primera llamada. Las contraseñas y las claves no van a la conversación: se ingresan en
el instalador o en la pantalla.

¿Prefieres un comando a una conversación? En tu computadora (macOS o Linux), antes de tener
servidor:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/start.sh | bash
```

Solo informa: qué necesitas, el tamaño de la máquina, el enlace de la alianza y el comando
siguiente. No instala ni recopila nada. Su salida está en portugués de Brasil.

### Ver una llamada sin clave ni troncal

El repositorio trae un motor de voz simulado. Ejecuta una llamada completa, con saludo,
herramienta, pedido de aprobación, transferencia y tarea posterior, sin clave de IA y sin
operadora. En tu computadora:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # requiere Docker: levanta un Postgres desechable y lo elimina al salir
```

## Qué hace hoy

DeskVoice publica versiones desde el 11/11/2026, y lo que cambia en cada una está en
[`CHANGELOG.md`](CHANGELOG.md) (en portugués). Para que nadie lo instale esperando lo que todavía
no se probó, cada capacidad dice hasta dónde llegó la prueba:

- **Probado en simulación:** cubierto por una prueba de punta a punta con el motor simulado, que
  recorre la llamada completa sin operador y sin clave.
- **Probado en una instalación real:** corrió en una VPS de verdad (las de prueba, el 11/11/2026,
  o la dedicada del socio, el 12/11/2026), de la forma y hasta el punto que describe la fila. Cada
  prueba, con sus salidas guardadas, está en [`docs/fundacao/instalacao-real.md`](docs/fundacao/instalacao-real.md) (en portugués).
- **Esperando prueba real:** implementado y probado contra servidores falsos y contra un Asterisk
  real, pero todavía sin una llamada hecha por un operador real.

| Capacidad | Hasta dónde se probó |
|---|---|
| Conversación de la llamada: saludo, turnos, herramientas, cierre | Probado en simulación |
| Avisar a una persona y pedir aprobación en medio de la llamada, con plazo y respuesta por defecto | Probado en simulación |
| Línea de tiempo de cada llamada, evento por evento, con costo | Probado en simulación |
| En la pantalla de cada llamada, las llamadas anteriores del mismo número (fecha, agente, desenlace y enlace) y sus pendientes abiertos; el aviso de transferencia y el de `notify_human` dicen cuántas veces ya llamó el número. Nada de esto llega al agente de la llamada | Probado con base de datos real, incluido el aislamiento entre empresas y que las instrucciones del agente no cambian; la prueba de pantalla corre en el CI, pero la pantalla no se vio en un navegador real. No se midió el rendimiento con muchas llamadas del mismo número, y el mismo número guardado de otra forma (con y sin el noveno dígito) cuenta como otro; lo que entrega la línea telefónica no se comprobó. Desde la 0.14.0 |
| Notas del agente sobre quien llamó (la herramienta `remember_caller_note`), que el equipo ve en el bloque "Este número" de la pantalla de la llamada; viene apagada y se marca en la pantalla del agente. Hasta 10 notas por llamada, con plazo de 90 días ajustable de 30 a 365 en Configuración, e incluidas en la exportación y en el borrado a pedido de quien llamó. El agente todavía no recibe las notas en la llamada siguiente. Desde la 0.16.0, cada nota tiene el botón "Borrar" en la pantalla de la llamada, y el dueño o un administrador puede "Olvidar este número" en Configuración → Privacidad: se van las notas y los pendientes cerrados del número; quedan las llamadas, el habla y los pendientes abiertos | Probado con base de datos real, incluido el aislamiento entre empresas, el tope de 10, el plazo y el borrado; la prueba de pantalla pasó en el CI. No se comprobó cómo usa la herramienta el modelo real, ni si evita anotar datos sensibles. Borrar y "Olvidar" se probaron con base de datos real y con una prueba de pantalla en el CI; la carrera con una llamada en curso del mismo número no se midió. Desde la 0.15.0 |
| Memoria del número en la llamada: con el interruptor "Entregar al agente la memoria del número" encendido (Configuración, panel de Privacidad), el agente empieza cada llamada, entrante o hecha por el sistema, con las notas guardadas sobre el número (hasta 10) y los títulos de sus pendientes abiertos (hasta 5), en un bloque de hasta 1 500 caracteres, recibido como dato y no como instrucción. El resumen y los turnos de llamadas anteriores nunca entran, y la línea de tiempo muestra solo cuántas notas y pendientes entraron. El interruptor viene apagado, solo el dueño o un administrador lo cambia, y la pantalla avisa que el número mostrado puede estar falsificado | Probado con base de datos real, incluido el aislamiento entre empresas, el plazo, el borrado y el interruptor apagado en las dos direcciones; el interruptor se vio en un navegador, en un panel local. Todavía sin llamada real con el interruptor encendido, sin medir el costo en tokens en un proveedor y sin prueba de que el modelo no repite las notas a quien insiste. Desde la 0.21.0 |
| Tareas que siguen después de la llamada (resumen, avisos, tareas de seguimiento) | Probado en simulación |
| Tope de costo y de duración por llamada | Probado en simulación |
| Tope por llamada en las herramientas que graban o avisan: 5 pendientes, 5 citas, 5 llamadas de webhook, 3 avisos al equipo y 3 pedidos de aprobación; por encima, la herramienta no corre y el agente dice que el pedido no quedó registrado | Probado con base de datos real, incluidas llamadas en paralelo, que no pasan del tope. Todavía sin llamada por operadora real. Desde la 0.13.0 |
| Panel web en portugués, inglés y español | Rutas probadas con base de datos real; pantallas revisadas en portugués |
| Instalar en una VPS con el kit de instalación | Probado en una instalación real, sin dominio: Ubuntu 22.04 en dos VPS de prueba y AlmaLinux 9 en la VPS del socio (allí, antes de que el instalador encendiera Docker por su cuenta, con el servicio encendido a mano). Debian y Rocky Linux todavía sin prueba |
| Panel y voz del navegador por la misma dirección, la entrada única de Caddy | Probado en una instalación real, sin dominio |
| Conversar por voz con el agente desde la pantalla "Hablar con el agente" | Probado en una instalación real con el motor OpenAI Realtime, por un cliente de prueba que hace el papel del navegador con habla grabada. Todavía no desde un navegador con micrófono |
| Panel con dominio y HTTPS | Esperando prueba real |
| Atender una llamada entrante por una línea de operador (troncal SIP) | Esperando prueba real |
| Filtro de entrada por línea: cada línea solo acepta llamadas de las direcciones que la pantalla muestra en "Acepta llamadas de". En la línea por IP, el servidor y las direcciones extra, y filtra siempre; en la línea por registro, la IP del servidor o las direcciones que su nombre devolvió en las últimas 24 horas (hasta 16), más las extra, recalculadas cada 5 minutos. En la línea por registro el filtro se enciende y se apaga en la pantalla; la que ya existía antes de la 0.29.0 sigue aceptando de cualquier dirección hasta que alguien encienda el filtro, y la registrada después ya nace filtrada. Mientras el nombre de una línea por registro nunca se haya resuelto, su filtro queda apagado, y la pantalla lo dice. El puerto 5060 sigue publicado como antes. Desde la 0.41.0, en una instalación con más de una organización, guardar una línea cuya dirección se cruza con el rango de una línea de otra organización, lo que deja fuera de servicio líneas por IP, pide confirmación antes de guardar; el aviso no dice qué línea, de qué organización ni en qué dirección, y cambiar solo el nombre nunca pregunta | Probado con base de datos real y con la resolución de nombres simulada; en la prueba de pantalla, una sonda SIP que se presenta como la línea desde otra dirección es aceptada con el filtro apagado y rechazada con él encendido. Medido en una instalación de prueba el 17/11/2026 con la misma sonda (OPTIONS): la línea por registro que ya existía quedó sin filtro en la actualización, y encender y apagar el filtro en la pantalla rechazó y volvió a aceptar. Todavía sin una llamada de verdad (INVITE con audio) ni operador real, y el texto de la pantalla no se vio en un navegador. El aviso de rango se probó con base de datos real y en la prueba de pantalla del CI, con la respuesta del servidor simulada; todavía sin prueba en una instalación real con más de una organización. La lista en la pantalla desde la 0.20.0; el filtro desde la 0.29.0; el aviso de rango desde la 0.41.0 |
| Transferir la llamada a una persona | Esperando prueba real (el camino en Asterisk se verificó, sin operador). Desde la 0.9.0, la transferencia que nadie atiende aparece como no atendida y genera un aviso en el panel con el pedido de devolver la llamada, probado con base de datos real y con la telefonía simulada |
| Pendiente abierto solo cuando la llamada termina sin próximo paso: el motor de voz se cayó o no estaba listo, la transferencia falló y nadie fue avisado, quien llamó colgó esperando una aprobación, o el mensaje de WhatsApp no salió y nadie abrió un pendiente. Una revisión por reglas fijas después de cada llamada, sin inteligencia artificial, sin gasto y sin leer lo que se dijo; como máximo uno por llamada, nunca para la simulada ni para la llamada sin número, y sin interruptor | Probado con base de datos real, incluidas revisiones en paralelo (queda una sola), el aislamiento entre empresas y el borrado a pedido de quien llamó. Todavía sin llamada por operador real, y el pendiente no se vio en la pantalla de Pendientes en un navegador. Desde la 0.19.0 |
| Pendiente o mensaje cuando la llamada se corta en medio de la conversación: en la pantalla del agente, "Cuando la llamada se corta" elige entre "No hacer nada" (el predeterminado, y el de todo agente que ya existía), "Abrir un pendiente para que alguien devuelva la llamada" y, desde la 0.27.0, "Enviar un mensaje de WhatsApp a quien llamó". Cuenta como corte la llamada entrante y atendida en la que el sistema falló, en la que quien llamó quedó sin respuesta más allá del plazo de la guarda del silencio y colgó (incluido quien oyó al agente pedir que repitiera y colgó sin volver a hablar), o en la que la línea se cayó durante una acción del agente; no cuenta quien se despide y cuelga, quien cuelga mientras el agente habla, la llamada sin número ni aquella en la que alguien ya se quedó con el próximo paso (transferencia, recado, pendiente, aviso o WhatsApp enviado). Un pendiente por llamada, para el responsable de los pendientes del agente, y la línea de tiempo dice lo que pasó; en la llamada simulada, dice lo que habría pasado y no se abre nada. El mensaje es un texto fijo de quien configura, de hasta 300 caracteres, sin nada de la conversación, y solo funciona con el WhatsApp conectado y "Confiar en el número que aparece en la llamada" encendido; la pantalla avisa que escribe primero a un número que puede no haber hablado nunca con la central, lo que puede llevar a restricción o bloqueo del número. Un número en la lista de no llamar no lo recibe; cada número recibe como máximo uno cada 24 horas, y la organización como máximo 3 por hora y 20 cada 24 horas; por encima de eso, o si el mensaje no sale, se abre un pendiente. Desde la 0.39.0, hay una cuarta opción, "Devolver la llamada": el sistema agenda una única nueva llamada 30 minutos después del corte, por la misma verificación de toda llamada saliente (política encendida, horario, tope, intentos y lista de no llamar), sin empujarla a la próxima ventana si cae fuera del horario, con como máximo una devolución por número cada 24 horas; cuando no sale o nadie atiende, abre el pendiente, salvo para un número en la lista de no llamar. Solo se puede elegir con las llamadas salientes encendidas | Probado con base de datos real y con el motor simulado, incluido el pedido de repetir seguido de colgar y la llamada grabada antes del cambio. Todavía sin llamada con motor de voz real ni por operador, sin medir con qué frecuencia esto pasa, y la pantalla no se abrió en un navegador; la opción del mensaje solo se vio en la prueba de pantalla automática, y el mensaje todavía no salió hacia un número real. La devolución de la llamada se probó con base de datos real, incluidos dos cortes al mismo tiempo para el mismo número, y todavía no marcó a un número real. Desde la 0.26.0 (el mensaje, desde la 0.27.0; devolver la llamada, desde la 0.39.0) |
| Pasar la llamada de un agente a otro en medio de la conversación: en la pantalla del agente, "Puede pasar la llamada a" marca los destinos (viene vacía), y la línea de tiempo muestra el paso, con el motivo y el resumen. Como máximo 3 pasos por llamada; pasar no reinicia el tiempo ni el costo, y valen la menor duración y el menor tope entre los agentes por los que pasó la llamada | Probado en simulación, incluido el tope del segundo agente y quien cuelga en medio del cambio; la lista en la pantalla del agente y la API probadas con base de datos real y con una prueba de pantalla en el CI; la tarjeta en la línea de tiempo, solo con una prueba de componente, sin navegador. En una instalación real, el 16/11/2026, se hizo un paso con el motor OpenAI Realtime, en una llamada por el navegador conducida por un script, con habla sintética, sin operador y sin pasar por el panel ([registro](docs/fundacao/instalacao-real.md#primeira-passagem-entre-agentes-com-motor-de-voz-real-na-vps-da-parceira-2026-11-16), en portugués). En el primer intento, el agente escribió el destino con la etiqueta y el paso fue rechazado; la 0.19.2 acepta esa forma de escribir, y con ella la misma prueba pasó en el primer intento ([registro](docs/fundacao/instalacao-real.md#a-mesma-passagem-refeita-com-a-0192-2026-11-16), en portugués). Los costos de cada agente en el extracto sumaron el total de la llamada, pero no se revisaron en la pantalla. Todavía sin llamada por operador real ni con habla de una persona. Si el proveedor rechaza la sesión del próximo agente, el agente actual sigue en la línea (probado en simulación). Desde la 0.17.0. Desde la 0.18.0, el costo de cada tramo aparece con el agente en el que estaba la llamada, en Costos (en el cuadro "Por agente", y los minutos de cada motor por tramo en el cuadro "Por motor de voz") y en la pantalla de la llamada, cuando pasó por más de un agente; el tramo de un agente que fue borrado vuelve a quien atendió. El costo por agente se probó con base de datos real, sin cambiar el total; las pantallas no se revisaron en un navegador |
| Buzón de voz: la llamada por la línea telefónica a un número sin agente, o con el agente apagado, se atiende con un aviso grabado y un pitido, y el mensaje queda en la propia llamada; apagado de fábrica, se enciende en Configuración → Llamadas y solo funciona con la grabación encendida. La llamada por WhatsApp sigue sin buzón de voz | Probado con base de datos real y con un transporte de prueba que se toma el tiempo del aviso. Todavía sin llamada por operadora real, y las pantallas no se revisaron en un navegador. Desde la 0.12.0 |
| Motor de voz OpenAI Realtime | Probado en una instalación real, en la conversación por la pantalla "Hablar con el agente" descrita arriba. Un colaborador hizo llamadas reales con él en una instalación propia, y, con la corrección del costo ([#94](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/94)), la estimación de DeskVoice coincidió con la factura de OpenAI. La corrección vale desde la 0.6.0 |
| Motor de voz Gemini Live | Esperando prueba real (probado contra servidor falso, sin clave) |
| Enviar WhatsApp durante la llamada, por conector | Esperando prueba real |
| Conectar un WhatsApp por código QR (Configuración → WhatsApp) y enviar por él los avisos y los mensajes del agente | El servicio no viene instalado: se instala desde la pantalla, y cuesta cerca de 323 MiB de memoria sin número conectado y 3,2 GB en disco (medido en la 0.3.0, el 12/11/2026). Rutas probadas con base de datos real y con un servicio de WhatsApp falso; instalar y quitar por el agente, con Docker simulado. **Aún sin prueba con un número real:** no se leyó ningún código QR y no salió ningún mensaje. Es un cliente no oficial de WhatsApp; mira la [guía](docs/guides/whatsapp-por-qr-code.md) (en portugués) |
| Que el agente atienda las llamadas hechas al número por WhatsApp (Configuración → WhatsApp, en el bloque Llamadas por WhatsApp: conectar el número y elegir el agente) | El servicio (WaCalls) no viene instalado: se instala desde la pantalla; memoria y disco aún no medidos. **Probado con un número real** en cuatro llamadas recibidas el 12 y el 13/11/2026 (la más larga de 2 min 7 s), con audio en los dos sentidos y transcripción, sin transferencia a una persona en este canal. El agente responde entre 0,6 y 2,4 s después de que quien llama deja de hablar (nueve respuestas medidas en las grabaciones de dos llamadas el 13/11; antes del ajuste que rellena el silencio que WhatsApp no envía, eran 4 a 5 s). Cuando WhatsApp oculta el número (`@lid`, hoy el caso común), vale el teléfono que informa la propia llamada, sin confirmación de WhatsApp, que pasa la imagen de WaCalls que usa el kit (un fork con la corrección, hasta que los autores la publiquen). **Probado en una llamada real con el número oculto** el 13/11/2026: el teléfono llegó a la línea de tiempo sin nada guardado en el registro de WaCalls. Cliente no oficial de WhatsApp; mira la [guía](docs/guides/ligacao-pelo-whatsapp.md) (en portugués) |
| Desenlace de la llamada (agendó, pidió que lo llamen, dejó recado, sin interés, solo información), clasificado por el motor después de la llamada; apagado de fábrica, se enciende en Configuración → Desenlace, análisis y transcripción | Probado con base de datos real y con una respuesta del proveedor simulada, con el costo dentro del límite de gasto y la falla en la línea de tiempo. Todavía sin prueba en una instalación real ni con OpenAI o Gemini de verdad. Desde la 0.8.0 |
| Análisis de la llamada al final, en la misma solicitud pagada del desenlace: la nota, que siempre es la suma de una rúbrica de cinco criterios con la frase que sostiene cada uno cuando aparece en la conversación, la temperatura de quien llamó, las objeciones con la respuesta del agente y el próximo paso; apagado de fábrica, se enciende en Configuración → Desenlace, análisis y transcripción, y la nota aparece en la lista de llamadas | Probado con base de datos real y con respuestas del proveedor simuladas: costo una sola vez en el extracto y dentro del tope, motivo en la línea de tiempo cuando el análisis no se hace, ningún texto de habla después del borrado a pedido de quien llamó. La pantalla se revisó en un panel contra una base descartable, con análisis grabados directo en la base. Todavía sin prueba en una instalación real ni con OpenAI o Gemini de verdad. Desde la 0.11.0 |
| Desenlace y análisis en un proveedor compatible con OpenAI (DeepSeek, Qwen, OpenRouter, Groq), con endpoint, modelo y clave propios en Configuración → Inteligencia artificial; el proveedor debe aceptar respuestas en `json_schema`; si no se configura, nada cambia. El costo en el proveedor configurado no se estima: aparece como cero y no cuenta en el tope del agente | Probado con base de datos real y con respuestas del proveedor simuladas, incluido el rechazo de direcciones internas y de un endpoint sin clave propia. Todavía sin prueba con un proveedor compatible de verdad. Desde la 0.11.0 |
| Cerebros (Configuración → Cerebros): quien configura pega la clave de Anthropic, de OpenAI, de Gemini, de DeepSeek o de OpenRouter y ve el resultado de la prueba y la lista de modelos de texto que la clave alcanza, con el precio de entrada y de salida por millón de tokens, con fuente y fecha, o "sin precio conocido". La clave queda cifrada, no vuelve a la pantalla y está separada de la clave del motor de voz. Desde la 0.23.0, un cerebro puede leer la llamada (fila de abajo) | Probado con base de datos real y con respuestas del proveedor simuladas, incluida la clave rechazada, el cambio de clave y el límite de lecturas. Todavía sin ninguna clave real de proveedor, y la pantalla no se abrió en un navegador. Desde la 0.22.0 |
| Desenlace y análisis de la llamada leídos por un cerebro elegido: con la clave guardada en Cerebros, la configuración `calls.analysis_brain` elige el cerebro y el modelo, y el desenlace y el análisis pasan a salir de él, por delante del motor de voz y del proveedor compatible. Desde la 0.24.0, la elección tiene pantalla: en Configuración, en la sección del análisis, "Quién lee la llamada" elige el cerebro y un modelo de su lista, que se busca por nombre. El extracto gana el modelo cobrado; un modelo sin precio conocido solo entra con confirmación, solo lee llamadas de agentes con tope de costo y queda marcado en el extracto como costo no medido. Desde la 0.24.0, Costos y la pantalla de la llamada muestran "No medido" en lugar de un costo cero, y la pantalla avisa antes de guardar un modelo sin precio; desde la 0.25.0, la lista de Llamadas y el final de la llamada de prueba también. Si el cerebro se queda sin clave o el modelo sale de la lista, la llamada no se lee y la línea de tiempo dice por qué. Desde la 0.39.0, cada agente puede tener su propia elección, en el bloque "Cerebros de este agente": igual que la organización (el predeterminado), el motor de voz del agente, o un cerebro y un modelo de la lista; la elección del agente vale sola, sin pasar a la de la organización, y el extracto muestra el modelo y el costo del agente. Sin elección, nada cambia | Probado con base de datos real y con respuestas del proveedor simuladas, incluido el costo no medido y el cerebro que desaparece. Todavía sin llamada real a ningún proveedor, y las pantallas de la 0.24.0 y de la 0.25.0 no se abrieron en un navegador. La elección por agente se probó con base de datos real, incluido el modelo que sale de la lista y el costo por el tope del agente, y la pantalla no se abrió en un navegador. Desde la 0.23.0 (la pantalla, desde la 0.24.0; por agente, desde la 0.39.0) |
| Filtro de habla (Configuración → Filtro de habla), apagado de fábrica: el Jev, de TypeSafe, lee el texto de la llamada y marca en la línea de tiempo lo que puede ser habla de fondo y la lectura probable de un término del vocabulario, sin cambiar el habla, que sigue como se oyó. Solo el dueño o el administrador guarda la clave y lo enciende; encenderlo pide la confirmación "El texto de la llamada va a TypeSafe.", después de un aviso que dice solo lo que dice la política de TypeSafe: guarda el texto por el tiempo que sea razonablemente necesario para prestar el servicio o para sus fines comerciales, sin plazo definido; a pedido, lo borra o lo guarda sin identificar a la persona cuando ya no sea razonablemente necesario, salvo obligación legal; alojamiento en los Estados Unidos, y cada confirmación deja un recibo en el Registro de la pantalla de Privacidad. El costo del pedido atrasado, sin red o con respuesta fuera de la forma se estima y se marca como estimación, y el pedido rechazado por TypeSafe con error no tiene costo; la guía `docs/guides/filtro-de-fala.md` (en portugués) dice cómo pedir el borrado a TypeSafe | Probado con base de datos real y con un servidor falso en lugar de TypeSafe, incluido el recibo que queda después de apagarlo. No se probó ninguna clave real del Jev, la pantalla no se abrió en un navegador y nadie confirmó que el contacto de TypeSafe atienda pedidos de borrado. Desde la 0.31.0 |
| Analistas en vivo (Configuración → Analistas), encendidos agente por agente en el campo "Analista" (viene en "Ninguno"): el analista lee la llamada con un modelo de decisión, mide la temperatura de quien llama (1 a 5, sello en el detalle de la llamada), reconoce objeciones registradas y entrega al agente la orientación escrita para cada una, sin que se vuelva habla. Con el Jev, valen el mismo aviso y la misma confirmación del filtro de habla. Con el motor Gemini Live, el analista mide pero no orienta, y la pantalla avisa. En Costos, los pedidos del analista tienen fila propia | Probado con base de datos real, con el motor simulado y con el render de la línea de tiempo; la orientación entra por el motor simulado y, en OpenAI Realtime, solo se probó contra un servidor falso, sin medida en una llamada real. La pantalla no se abrió en un navegador, y ningún analista leyó una llamada real. Desde la 0.31.0 |
| Ambiente de quien llama, normal o ruidoso, en la pantalla del agente: en Ruidoso el agente es menos sensible al ruido para empezar a escuchar. En OpenAI Realtime y en Gemini Live; si un agente cambia a otro motor, la pantalla avisa y ofrece volver a Normal | Una sesión en Ruidoso fue aceptada por OpenAI Realtime en una instalación real, sin llamada. Gemini Live aceptó la sesión en Ruidoso, sola y junto con el vocabulario, sin llamada y sin audio de entrada. La pantalla se revisó en un panel contra una base descartable. El efecto en el reconocimiento de voz no se midió. Desde la 0.11.0 |
| "Nombres y términos" en la pantalla del agente: nombres de personas, de la empresa, de productos y términos que quien llama suele decir, uno por línea, hasta 50 términos de hasta 60 caracteres. La lista va al proveedor de voz como pista para reconocer esas palabras, y el proveedor puede no seguir la pista; el error aparece al lado del campo, sin guardar. Quien no lo complete no ve diferencia | Probado con base de datos real, en el render de la pantalla y en la prueba de pantalla del CI. En una instalación de prueba, el 17/11/2026, Gemini Live aceptó la sesión con una lista corta; la lista llena (50 términos de 60 caracteres) no se probó ni en Gemini ni en OpenAI Realtime, y si un proveedor la rechaza la sesión del agente con términos no se abre. No se midió si el reconocimiento mejora. Desde la 0.33.0 |
| Voz de ElevenLabs (Configuración → Voz): guarda la clave de ElevenLabs cifrada, prueba la clave sin gastar caracteres y muestra las voces que la cuenta ya tiene, con idioma y muestra. Guardar la clave pide la confirmación de que el texto que el agente dice en la llamada va a ElevenLabs y puede repetir lo que la persona dijo, como nombre, dirección y teléfono; el aviso dice lo que dicen las páginas de ElevenLabs (historial hasta borrarlo, más 30 días en copia de seguridad, registros que pueden quedar guardados sin plazo declarado, sin retención solo en el plan Enterprise, datos guardados en los Estados Unidos, dónde procesa no declarado), y quien confirmó queda en el Registro de la pantalla de Privacidad. El agente todavía no habla con esta voz: elegir la voz en el agente viene después | Probado con base de datos real y con un servidor falso en lugar de ElevenLabs, incluido el recibo que queda después de borrar la clave. No se probó ninguna clave real, la pantalla no se abrió en un navegador, y los Términos de Servicio y el acuerdo de datos de ElevenLabs no se leyeron. Desde la 0.34.0 |
| Aviso de fin de llamada en el WhatsApp de quien opera, con texto fijo (sin habla ni teléfono de quien llamó); apagado de fábrica, se enciende en Configuración → WhatsApp | Probado con base de datos real y un WhatsApp falso. Todavía sin prueba con un número real. Desde la 0.8.0 |
| Llamar a un webhook durante la llamada. Desde la 0.42.0, cuando la integración no responde dentro del plazo, el agente no lo trata como error: oye que no se sabe si el pedido quedó registrado y que no debe repetirlo sin confirmar con la persona, y dice que lo va a verificar; la línea de tiempo muestra "não respondeu a tempo". El error HTTP y la falla de red siguen como antes. Cada llamada lleva la cabecera `Idempotency-Key`, igual para la misma llamada, la misma integración y los mismos datos; evitar el pedido duplicado depende de que el otro sistema respete esa cabecera. Desde la 0.44.0, cada webhook permitido tiene su propio plazo de respuesta, de 1 a 30 segundos, en Configuración › Integraciones; el valor por defecto sigue siendo 10 segundos, y la lista ya guardada sigue con 10 sin que nadie la toque. El plazo vale durante la llamada y en las entregas posteriores | Esperando prueba real (sin un receptor real). El plazo agotado y la cabecera, desde la 0.42.0, se probaron con base de datos real y un servidor falso; todavía no se midió cómo reacciona el modelo al "no sé" en una llamada real ni cuántos receptores respetan la cabecera. El plazo por webhook, desde la 0.44.0, se probó con un servidor falso y en la prueba de pantalla del CI; la pantalla no se abrió en un navegador, y no se midió qué plazo sirve para cada integración real |
| Pulsar las teclas de un menú automático (IVR) durante la llamada, con la herramienta `send_dtmf` | Medido en un Asterisk local, con la imagen y el dialplan de la instalación, contra otro Asterisk en el papel del IVR: el menú que reconoce el tono en el audio leyó las teclas; el que solo acepta teclas por RFC 4733 no las leyó. Todavía sin prueba con el IVR de un operador |
| Atender por un menú por teclas: en Línea telefónica, cada número puede cambiar "Atiende: IA (el agente)" por "Menú por teclas". El menú tiene un nivel; quien llama oye un anuncio grabado (WAV, MP3 o M4A, hasta 60 segundos, convertido en el navegador) y pulsa una tecla que lleva a un agente de IA, a una persona o cuelga. Todo menú tiene al menos una tecla para una persona, y es a ella a quien va la llamada cuando nadie elige (o el menú avisa y cuelga, si quien configura lo prefiere) y cuando algo falla. La línea de tiempo muestra la opción elegida, nunca la secuencia marcada. Todo número sigue atendido por la IA hasta que alguien lo cambie, y la llamada por WhatsApp no pasa por el menú. Construido a partir del trabajo de webtecnica | Probado con base de datos real y en unidad, incluido cada camino de falla que va a la persona, el anuncio fuera de la purga de grabaciones y el número de WhatsApp fuera del menú. Todavía sin prueba en una llamada real, por línea de operador, con el menú encendido desde el panel, y la conversión del anuncio no se revisó en navegadores diferentes. Desde la 0.38.0 |
| Actualización, chequeo de salud, respaldo y restauración | Probado en una instalación real, en la VPS del socio: instalador corrido dos veces sin regenerar secretos, respaldo verificado, restauración que devuelve los conteos del respaldo y la vuelta automática de una actualización fallida. Restaurar en otro servidor, o entre versiones con migration nueva, todavía sin prueba |
| Cerrar hacia afuera un puerto que Docker publica, con una regla hecha para volver después de reiniciar: `install/docker-user.sh apply 5061/tcp` (o la variable `DESKVOICE_DOCKER_USER_DROP` en el instalador) escribe la regla en la cadena `DOCKER-USER`, que ni el `ufw` ni el `firewalld` alcanzan, y deja un servicio de systemd hecho para reponerla en el arranque y en cada reinicio de Docker. No se cierra nada sin que se pida, y cerrar el `5060/udp` deja la telefonía muda. Aplicar la regla carga el módulo `br_netfilter` hasta el reinicio (ver `docs/fundacao/ufw-e-docker.md`, en portugués) | Medido en una VPS de prueba el 18/11/2026: desde afuera, los puertos de prueba dejaron de responder en TCP y UDP; la conexión que el contenedor abre hacia afuera y la conversación entre contenedores de la misma red siguieron pasando, en TCP; aplicar de nuevo no duplicó la regla. El reinicio de la máquina y el de Docker con el servicio encendido (la vuelta de la regla), UDP de salida y entre contenedores, IPv6 y firewalld activo todavía sin prueba. Desde la 0.36.0 |
| Actualizar desde el panel (Administrar la instalación → Actualización), mediante un agente del kit en el servidor | Probado en una instalación real: dos veces en la VPS del socio (0.3.0 → 0.4.0 y 0.4.0 → 0.5.0), sin nadie en la terminal del servidor, con el paso al actualizador de la versión nueva y la eliminación de las imágenes viejas |
| Área de la instalación, para quien cuida de varios clientes en un solo servidor: quien administra la instalación gana "Administrar la instalación" en el bloque de la cuenta, con cuatro pantallas. En Organizaciones, lista, crea y renombra organizaciones, y cada organización nueva genera la invitación del primer dueño, que guarda quién la generó y solo vale mientras esa cuenta administre la instalación. En Visión general, desde la 0.37.0, ve una fila por organización: si está activa o suspendida, las llamadas de los últimos 30 días, el costo del mes (con las marcas "incluye estimación" y "No medido", como en Costos), las líneas conectadas y caídas, el estado de la clave del motor y la cola (tareas atrasadas y con falla en las últimas 24 horas), cada número igual al de la pantalla de la propia organización. En Administración, pone o quita a quien administra la instalación, y la última persona nunca sale. En Auditoría queda lo que se hizo allí, incluido cada pedido de actualización. Quien tiene un solo cliente no ve nada nuevo en la navegación principal. Crear la segunda organización fija la lista de quien administra la instalación, sin vuelta atrás, y la pantalla muestra antes quién entra y quién sale; desde entonces, la actualización sale de Configuración y pasa al área de la instalación. El dueño de una organización cliente no gana el área. Desde la 0.35.0, quien administra la instalación suspende y reactiva una organización en Organizaciones, con motivo y una confirmación que nombra la organización; la suspendida no atiende, no llama y tiene canceladas las tareas que actúan en nombre de la organización o gastan (avisos, webhooks, transcripciones, resúmenes y análisis), mientras la conservación, el borrado de datos de quien llamó y el vencimiento de aprobaciones siguen; lo que se canceló no vuelve con la reactivación, y todo queda en la auditoría. El botón no aparece para la única organización activa. Desde la 0.39.0, cada organización gana en Organizaciones el botón Límites, con el número máximo de líneas telefónicas y de agentes y el uso al lado; por encima del límite, crear más se rechaza con el conteo, bajar un límite no borra nada, y la organización ve sus propios límites en Configuración, solo para lectura. Sin límite definido, nada cambia. Desde la 0.40.0, en Límites, el campo Llamadas salientes bloquea toda llamada saliente de la organización, incluida la devolución de la llamada, sin cambiar la elección de ella: desbloquear devuelve la salida como ella la había dejado. La transferencia a una persona, en medio de una llamada entrante, sigue. Desde la 0.41.0, en Límites, el campo Tope de gasto del mes (en dólares, la moneda del costo que DeskVoice mide) muestra al lado cuánto ya gastó la organización en el mes, la misma suma de la pantalla de Costos; cuando la suma llega al tope, toda llamada nueva de la organización se rechaza al inicio, antes de abrir el motor de voz: la recibida por la línea telefónica o por WhatsApp oye el mensaje de no disponible, y la saliente, la devolución de la llamada y la llamada por el navegador no salen, con el motivo en la pantalla y en la línea de tiempo. La llamada en curso no se corta. El valor es aproximado (incluye costo estimado y no incluye lo que no se pudo medir), y dos llamadas que empiezan juntas justo debajo del tope pasan las dos. La organización ve el tope y el gasto del mes en Configuración, y la Visión general gana la columna Tope del mes. Sin tope, nada cambia. Desde la 0.42.0, en Organizaciones, la sección "Valores por defecto para organizaciones nuevas" guarda los límites con los que nace cada organización nueva (líneas, agentes, tope del mes y si puede llamar hacia afuera), y el formulario de nueva organización dice antes de crear con qué nace. Sin valor por defecto elegido, la nueva nace sin límite de líneas, de agentes y de gasto, y con la salida bloqueada hasta que alguien la desbloquee en sus límites; antes, nacía sin ningún bloqueo. La nueva recibe una copia: cambiar el valor por defecto después no toca ninguna organización que ya existe, y la organización de quien instaló y las que ya existen siguen como están. El cambio del valor por defecto queda en la Auditoría. Desde la 0.43.0, los valores por defecto también traen el huso horario (con nombre IANA, como America/Sao_Paulo), que vale para la ventana de llamadas y para el mes de costo de la organización nueva, y el idioma (portugués, inglés o español) que proponen su formulario de agente nuevo y el de menú nuevo; los agentes y menús que ya existen no cambian, y el idioma de la pantalla sigue siendo el de cada navegador. Sin valor por defecto elegido, la nueva nace en America/Sao_Paulo y propone portugués, como antes. Las organizaciones que ya existen no cambian de huso horario, de mes de costo ni de idioma, ni siquiera cuando el valor por defecto cambia después | Probado con base de datos real, incluida la creación de la segunda organización, el aislamiento entre organizaciones y la invitación que deja de valer cuando quien la generó pierde el papel o tiene la cuenta borrada. La prueba de pantalla del CI recorre Organizaciones y Administración; no crea la segunda organización ni abre la Auditoría. Las pantallas no las abrió una persona en un navegador, y todavía no hay prueba en una instalación real con más de una organización; la suspensión se probó con base de datos real y en la prueba de pantalla del CI. La Visión general se probó con base de datos real, con los números de cada organización comparados con los de su Costos y su Salud del sistema; la prueba de pantalla del CI solo verifica que la sección aparece en la navegación. Los límites se probaron con base de datos real, incluidas dos creaciones al mismo tiempo en el límite, y la prueba de aislamiento exige que ninguna organización cambie sus propios límites. El bloqueo de la salida se probó con base de datos real, incluida la devolución de la llamada ya agendada, que no sale y se vuelve pendiente. El tope del mes se probó con base de datos real en las cuatro puertas (línea telefónica, WhatsApp, salida y navegador), incluido el límite exacto, el cambio de mes en el huso horario de la organización y la devolución de la llamada rechazada; todavía sin prueba en una instalación real. Los valores por defecto para organizaciones nuevas se probaron con base de datos real, incluido que la organización de quien instaló y las que ya existen no cambian y que cambiar el valor por defecto no toca una organización ya creada; la sección nueva no se abrió en un navegador. El huso horario y el idioma por defecto se probaron con base de datos real, y la propuesta del idioma por la ruta de la sesión, no por la pantalla; el campo nuevo y los formularios que proponen el idioma no se abrieron en un navegador. Desde la 0.30.0 (suspender, desde la 0.35.0; Visión general, desde la 0.37.0; límites, desde la 0.39.0; bloqueo de la salida, desde la 0.40.0; tope del mes, desde la 0.41.0; valores por defecto para organizaciones nuevas, desde la 0.42.0; huso horario e idioma por defecto, desde la 0.43.0) |
| La misma persona en varias organizaciones, con la misma cuenta: el nombre y el papel valen solo en cada organización, y quien tiene vínculo activo en más de una gana un selector en la parte de arriba de la pantalla para cambiar sin salir del panel; quien tiene una sola organización no ve nada nuevo. El inicio de sesión vuelve a la última organización usada. Desactivar o quitar a la persona en una organización no toca las otras, y el cambio de contraseña cierra las otras sesiones de la cuenta en todas | Probado con base de datos real, incluido el aislamiento entre organizaciones después del cambio, y en la prueba de pantalla del CI. El selector no lo abrió una persona en un navegador, y todavía no hay prueba en una instalación real con más de una organización. Desde la 0.32.0 |
| Aviso de versión nueva en la barra lateral del panel, destacado solo para el dueño y los administradores, que lleva directo a la pantalla de actualización; el operador ve la versión en ejecución, sin destaque | Probado en unidad, incluido que el operador no ve el destaque. La barra lateral no se revisó en un navegador. Justo después de que sale una versión, la barra lateral puede avisar antes de que la pantalla de actualización ofrezca el botón. Desde la 0.13.0 |
| Grabar el audio de la llamada, apagado de fábrica y encendido desde el panel (Configuración → Privacidad → Grabación de las llamadas) | Probado con base de datos real y en una llamada por el navegador, en una prueba de punta a punta. Todavía sin prueba en una instalación real. Desde la 0.6.0 |
| Huella digital (SHA-256) de cada grabación y de cada mensaje de buzón, en la línea de tiempo de la llamada, para comprobar si una copia del audio es igual a la grabada. No prueba nada frente a quien administra el servidor, porque la huella queda en la misma máquina que el audio | Probado con base de datos real; la línea de tiempo se revisó con una prueba que genera la pantalla, no en un navegador. Las grabaciones anteriores a la actualización no tienen huella. Desde la 0.13.0 |
| Detener la grabación a pedido de quien llama, por el agente (herramienta `stop_recording`, marcada en cada agente) o por el botón en la pantalla de la llamada en vivo; la detención queda en la línea de tiempo | Probado con base de datos real, en la sesión de llamada real, con motor y telefonía simulados. Todavía sin prueba en una instalación real. Desde la 0.9.0 |
| Transcribir la grabación de una llamada que quedó sin texto, por el proveedor del agente, con cada lado de la llamada por separado; apagado de fábrica, se enciende en Configuración → Desenlace, análisis y transcripción, y el botón está en la pantalla de la llamada, junto al aviso de que, con el desenlace o el análisis encendidos, transcribir también dispara la clasificación paga | Probado con base de datos real y con respuestas del proveedor simuladas: costo en el extracto y en el tope, la falla del proveedor con el motivo en la línea de tiempo, rechazo de la llamada borrada, fuera del plazo de conservación o demasiado larga para el proveedor sin cargar la grabación en la memoria. Todavía sin prueba en una instalación real ni con OpenAI o Gemini de verdad. Desde la 0.10.0 |
| Transcribir sola, al final de la llamada, la grabación que quedó sin habla alguna, antes del resumen final, el desenlace y el aviso; interruptor propio, apagado de fábrica, en Configuración → Desenlace, análisis y transcripción, que solo funciona con la transcripción a pedido también encendida. Cada llamada transcrita es una solicitud pagada al proveedor, en el costo y en el tope | Probado con base de datos real y con respuestas del proveedor simuladas: la llamada que ya tiene habla no se transcribe de nuevo, y la grabación demasiado larga ni se lee. Todavía sin prueba en una instalación real ni con OpenAI o Gemini de verdad. Desde la 0.11.0 |
| Plazo de conservación de la transcripción y exportación de lo que la organización guarda sobre un teléfono (Configuración) | Probado con base de datos real y revisado en pantalla, en un panel contra una base descartable. Todavía sin prueba en una instalación real. Desde la 0.6.0 |
| Borrar a pedido de quien llamó (Configuración → Privacidad): vista previa de lo que sale, confirmación que nombra el teléfono, recibo; sale toda el habla y el texto sobre la persona, incluida la grabación, y queda el registro del servicio. Las copias de respaldo ya hechas no se alcanzan | Probado con base de datos real, incluida la vuelta por la exportación. Todavía sin prueba en una instalación real. Desde la 0.9.0 |
| Enlace temporal para que quien llamó descargue la grabación de su propia llamada, creado en la pantalla de la llamada por el dueño o un administrador: vale 72 horas y 10 descargas, sin inicio de sesión, y la pantalla lo revoca al instante; cada creación, revocación y descarga queda en el registro de Privacidad | Probado con base de datos real, incluidas descargas simultáneas que no pasan del límite. Ni la pantalla de la llamada ni la página /s/<token> que abre quien llamó se revisaron en un navegador, y sin dominio el enlace solo abre desde dentro del servidor. Desde la 0.12.0 |
| Llamadas hechas por el agente | Esperando prueba real, y apagado de fábrica. Ver "Llamadas salientes" |

Si usted atiende una llamada por una línea de operador, cuente cómo fue en un issue: la entrada
por troncal SIP todavía no tiene registro público, y es la contribución más valiosa en este
momento.

Lo que **no** existe todavía: varias
empresas en la misma pantalla, constructor visual de flujos, IVR por voz,
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

## Contactos que la instalación hace por su cuenta

DeskVoice no tiene telemetría: ningún dato de uso, de llamada o de la instalación va al
proyecto. Estos son todos los contactos con el exterior que la instalación hace sin que lo pidas:

| Quién | Con quién | Cuándo | Qué envía |
|---|---|---|---|
| Panel | API pública de versiones de GitHub (`api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases`) | Cuando alguien abre Administrar la instalación → Actualización o confirma una actualización. La respuesta se guarda 10 minutos (1 minuto, si la consulta falló) | Una petición de lectura sin credencial y sin cuerpo, con dos cabeceras fijas, iguales en toda instalación: `accept: application/vnd.github+json` y `user-agent: deskvoice-panel`. Ninguna versión, dirección o identificador de la instalación |
| Agente de actualización | El repositorio en GitHub, con `git fetch --tags` | El agente pasa cada minuto y busca las versiones como mucho cada 10 minutos, cuando la instalación está en una versión publicada y vino de un clon del repositorio | La petición de git para buscar las etiquetas, sin credencial. git se identifica con su propia versión (`git/2.x`); nada de la instalación va con ella |
| Caddy, solo con dominio | La autoridad de certificados que usa Caddy (Let's Encrypt, por defecto) | Al instalar y, después, por su cuenta, para renovar el certificado antes de que venza | El dominio, para probar que apunta a la VPS. DeskVoice no configura e-mail en esa petición |

Cuando lo pides, la instalación también habla con el exterior:

- **Instalar y actualizar** (por la terminal o por la pantalla) descarga el código de GitHub y las
  imágenes: las de DeskVoice en `ghcr.io` (panel, voz y rutinas) y las de terceros en Docker Hub
  (Postgres, Caddy, Asterisk). Docker se identifica como en cualquier descarga de imagen (su
  versión, la del kernel y la arquitectura); DeskVoice no añade nada.
- **Instalar sin indicar la IP** (`DESKVOICE_PUBLIC_IP`): el instalador descubre la IP pública de la
  VPS preguntando a `api.ipify.org`, `ifconfig.me` e `icanhazip.com`, uno por vez, hasta que uno
  responda. La petición no lleva nada; el servicio ve la IP de la VPS, que es la respuesta.
  `install/diagnose.sh` hace la misma consulta.
- **Instalar sin Docker:** después de preguntar, el instalador descarga el script oficial de
  `get.docker.com`.
- **Instalar WhatsApp por la pantalla:** el agente descarga la imagen de WAHA de Docker Hub, y lo
  intenta de nuevo cada 10 minutos si la descarga falla.
- **Construir en la propia máquina** (`--build`): descarga la base de Node de Docker Hub, pnpm y los
  paquetes del registro de npm.

En el uso, DeskVoice habla con lo que configuraste: el proveedor de IA de voz (Google u OpenAI)
durante las llamadas, con tu clave; la operadora del troncal SIP; WhatsApp, por WAHA, si lo
conectaste; y las direcciones de las herramientas y webhooks que registraste. Con el desenlace o el análisis de
la llamada encendidos (Configuración → Desenlace, análisis y transcripción, apagados de fábrica), el proceso de
rutinas también envía la transcripción en texto al mismo proveedor, después de la llamada, por su
API de texto (`/chat/completions` en OpenAI, `:generateContent` en Google), o al endpoint compatible con
OpenAI que configuraste para eso.

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
se construye en público, con la comunidad. Ya hay contribuciones de fuera: las cercas y la
seguridad de [webtecnica](https://github.com/webtecnica) están en las versiones publicadas, y desde la 0.6.0 también los
derechos de quien llama (plazo de conservación y exportación), de webtecnica, y el costo de OpenAI
verificado contra la factura, la despedida antes de colgar y la grabación de las llamadas, de
[aliffstefano](https://github.com/aliffstefano). La 0.8.0 trae el desenlace de la llamada y el aviso de fin de llamada por WhatsApp, de webtecnica, y la 0.9.0, también suya, las teclas del menú automático, la transferencia no atendida, la grabación que se detiene a pedido y el borrado a pedido de quien llamó, y la 0.10.0, también suya, la transcripción de la grabación, y la 0.11.0, también suya, el plazo de conservación que alcanza el resumen de la llamada, el costo exacto de la lectura del desenlace y el desenlace en un proveedor compatible con OpenAI, el aviso de costo y la falla de la transcripción en pantalla, la línea por IP con varios bloques, la transcripción automática al final de la llamada y las guías de implantación para clínicas y para la misma VPS del CRM, y la 0.12.0, también suya, el buzón de voz, el enlace para que quien llamó descargue la grabación y las imágenes para ARM, y la 0.13.0, también suya, el aviso de versión en la barra lateral, el tope por llamada en las herramientas, las cabeceras de seguridad del panel y la huella digital de la grabación. DeskcommCRM, de donde viene la forma de contribuir
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
