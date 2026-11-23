# Voz del agente (ElevenLabs)

El motor de voz en pipeline (diseño `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`) separa la
voz del agente del cerebro y de la transcripción. La primera voz de fuera es la de **ElevenLabs**.

**En esta versión, solo la clave y la lista de voces.** El agente todavía no habla por ElevenLabs:
elegir la voz en el agente es una etapa posterior. Guardar la clave ya prueba la cuenta y muestra
las voces, para cuando llegue la elección.

ElevenLabs es opcional. Sin clave nada cambia: ningún pedido sale, y quien ya instaló no ve
diferencia salvo la sección nueva en Configuración.

## Guardar la clave

En **Configuración → Voz**, al lado de **Cerebros**. Solo dueño o administrador la cambia.

1. Lea el aviso **Adónde va el texto** (lo que dice está abajo, en "Lo que ElevenLabs dice que hace
   con el texto").
2. Pegue la clave de ElevenLabs (<https://elevenlabs.io/app/settings/api-keys>).
3. Marque la confirmación: "El texto que el agente dice en la llamada va a ElevenLabs. Puede
   repetir lo que la persona dijo, como nombre, dirección y teléfono."
4. Haga clic en **Guardar y probar**. La clave queda cifrada y nunca vuelve a la pantalla. La prueba
   pide una voz de la cuenta (`GET /v2/voices`), que no gasta caracteres, y dice el resultado:
   aceptada, rechazada, sin crédito, etc.

Sin la confirmación, la clave no se guarda. Quién confirmó y cuándo quedan guardados, y el
**Registro** de la sección Privacidad recibe la línea "Ana confirmó que la voz ElevenLabs recibe el
texto que el agente dice en la llamada". Esa línea queda aunque la clave se borre o la persona deje
el equipo.

Quitar la clave borra la confirmación. Una clave nueva pide la confirmación de nuevo, con una línea
nueva en el Registro. Probar de nuevo la misma clave no pide confirmación ni crea línea.

## Las voces

Con la clave aceptada, la sección muestra las voces que la cuenta ya tiene, con los idiomas que
ElevenLabs declara verificados para cada una. Las de portugués de Brasil van primero. El botón de
escuchar reproduce la muestra que la propia ElevenLabs aloja (`preview_url`): **no gasta crédito**.
DeskVoice no guarda audio ni la lista: se lee de la cuenta cada vez que la sección la pide.

## Lo que sale del servidor

Cuando la voz esté activada en el agente (etapa posterior), va a ElevenLabs **el texto que el
agente dice en la llamada**. Al confirmar un pedido, el agente repite lo que la persona dijo:
nombre, dirección, teléfono y horario. En esta versión solo sale la clave, en la prueba y al leer la
lista de voces.

## Lo que ElevenLabs dice que hace con el texto

Leído el 17/11/2026, 15:50 UTC, y comprobado de nuevo a las 17:23 UTC del mismo día, en la entrega:

1. **Zero Retention Mode**, <https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>
   (sha256 de la versión `.md`: `0ca7448c2279cb985a0971253793499c53a8cb615adf3b01997bd6562f598087`,
   igual en las dos lecturas):
   - la tabla "Default Retention" dice que, en Text to Speech, el texto enviado (*Text Input*) y el
     audio generado (*Audio Output*) se guardan por defecto (**Enabled**);
   - "Customers by default have history preservation enabled. All customers can use the API to
     delete generations at any time. This action will immediately remove the corresponding audio and
     text from our database; however, debugging and moderation logs may still retain data related to
     the generation.";
   - "Following data deletion, database items are retained in backups for up to 30 days.";
   - el modo sin retención es **solo del plan Enterprise**: "Enterprise customers can use Zero
     Retention Mode".
2. **Política de privacidad**, <https://elevenlabs.io/privacy-policy> ("Updated 9 October 2026";
   sha256 del HTML en la primera lectura:
   `c45b9f33cfe1406f47e867e4eb3864d55602ee228441851b2efac812c85d3880`; en la segunda cambiaron los
   bytes del HTML, `c2d6101a…`, pero el texto visible es el mismo):
   - sección 6: "We generally keep your personal information for as long as necessary to provide
     you with our Services […] for example, for as long as you have an account with us";
   - "Wherever you are, your personal information will be transferred to the United States for
     storage."

En resumen, fuera de Enterprise:

- **Retención:** el texto queda en el historial de la cuenta hasta que alguien borre la generación
  o la cuenta. La página no da otro plazo.
- **Después de borrar:** queda hasta 30 días en copias de seguridad.
- **Registros de depuración y moderación:** pueden guardar datos de la generación, sin plazo
  declarado.
- **Almacenamiento:** en Estados Unidos (política de privacidad, actualizada el 9/10/2026).
- **Procesamiento:** ElevenLabs no declara dónde procesa. DeskVoice dice "no declarado"
  (`processingLocation: undeclared`) y no supone país.

El proyecto no leyó los Términos de Servicio, el DPA ni la página de seguridad de ElevenLabs.

La decisión de ofrecer ElevenLabs aun sin plazo de retención fue de Rafael, el 17/11/2026, con el
aviso diciendo lo que dicen las páginas (DESA-103, opción A).

## Borrar lo que se envió

El borrado de DeskVoice (plazo de guarda, pedido de quien llamó) **no alcanza a ElevenLabs**. Para
borrar el texto allá, borre las generaciones en el historial de la cuenta de ElevenLabs (en su app o
por la API). Quedan la copia de seguridad de hasta 30 días y los registros de depuración y
moderación. Quitar la clave en DeskVoice solo detiene los envíos nuevos.
