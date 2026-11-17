# Filtro de habla

El filtro de habla lee el texto de lo que dice la persona en la llamada y hace dos cosas:

- **marca** el habla que puede ser de fondo (TV, radio, otra persona en la sala), con la confianza;
- **sugiere** la lectura probable de un término del vocabulario del agente, cuando la
  transcripción pudo escribir mal un nombre ("meu gasto" en lugar de "Melgaço"). La sugerencia solo
  aparece con una confianza de 0,8 o más.

**Solo marca y sugiere.** Ninguna decisión borra habla ni cambia lo que dijo la persona: el texto
oído sigue en la línea de tiempo, y la marca y la sugerencia aparecen a su lado. La llamada nunca
espera al filtro. Una decisión que llega después del turno, o que no llega en el plazo de 1 s, queda
en la línea de tiempo como observación y no cambia nada.

El filtro viene **apagado**. Quien ya instaló no ve diferencia hasta que alguien lo encienda.
Apagado, la llamada es la misma de antes: no sale ningún pedido y no aparece ninguna línea nueva en
la línea de tiempo.

El diseño completo está en `docs/specs/2026-11-14-transcricao-pura.md`, parte 3 (en portugués,
todavía en el PR #198, fuera de `main`).

## Encender

En **Configuración → Filtro de habla**. Solo el dueño o un administrador lo cambia; los otros roles
lo ven.

1. En **Claves de los modelos**, pega la clave de Jev y haz clic en **Guardar y probar**. La clave
   queda cifrada en la base y nunca vuelve a la pantalla. La prueba pide la lista de modelos de la
   cuenta, sin costo de tokens, y muestra el resultado (aceptada, rechazada, sin crédito, etc.).
2. En **Modelo de decisión**, elige **Jev (TypeSafe)**.
3. Lee el aviso **A dónde va el texto** y marca la confirmación: "El texto de la llamada va a
   TypeSafe." Lo que va, en detalle, está en "Qué sale del servidor", justo abajo.
4. Haz clic en **Guardar**. La pantalla pasa a mostrar quién confirmó el envío y cuándo.

Sin la confirmación, Jev no se guarda. Apagar (elegir **Ninguno**) borra la confirmación, y volver a
encender pide otra.

## Qué sale del servidor

Jev es de TypeSafe AI y corre fuera de este servidor. Por cada frase de quien llama sale un pedido
con:

- la frase de quien llama, como la escribió la transcripción;
- la última frase del agente, cuando la hay;
- las preguntas del filtro, que son fijas, y, cuando el agente tiene vocabulario, hasta cuatro de
  sus términos parecidos a la frase.

El costo de cada pedido entra en el costo de la llamada, al precio del archivo del modelo (US$ 0,042
por millón de tokens de entrada, salida gratis, revisado el 16/11/2026). Cuando el pedido sale y el
consumo no vuelve (atrasado, sin red, respuesta fuera de forma), el costo se estima por la entrada
enviada, se marca como estimado y cuenta en el tope de la llamada.

## Qué dice TypeSafe que hace con el texto

Fuente: la política de privacidad de TypeSafe, <https://typesafe.ai/legal/privacy-policy> ("Last
updated Nov 19, 2025"), leída el 16/11/2026.

- **Retención:** TypeSafe guarda los datos personales que recibe, como este texto, durante el
  tiempo que sea razonablemente necesario para prestar el servicio o para sus fines comerciales. La
  política no define plazo.
- **Borrado:** a pedido, borra esos datos o los guarda de una forma que no identifique a la
  persona cuando ya no sean razonablemente necesarios, salvo que la ley la obligue a guardarlos por
  más tiempo.
- **Lugar:** el servicio está alojado en los Estados Unidos.

El proyecto no leyó el contrato de TypeSafe ni las páginas que piden inicio de sesión.

## Pedir el borrado a TypeSafe

La página no trae un canal propio para el pedido de borrado. El contacto que da para dudas sobre el
tratamiento de datos es **privacy@typesafe.ai**. Escribe a esa dirección desde la cuenta de TypeSafe
de tu organización (la dueña de la clave), di qué datos quieres borrar (por ejemplo, los enviados
entre dos fechas) y guarda la respuesta. Según la política, el borrado depende de dos condiciones:
que los datos ya no sean razonablemente necesarios para TypeSafe y que ninguna ley la obligue a
guardarlos por más tiempo. No promete plazo para atender el pedido.

Apagar el filtro no borra lo que ya se envió: solo detiene los envíos nuevos. El borrado de
DeskVoice (plazo de guarda y pedido de quien llama) tampoco alcanza a TypeSafe.

## En la línea de tiempo

- **Puede ser habla de fondo (confianza 0,82):** debajo de la frase, que sigue entera.
- **Lectura probable: Melgaço (confianza 0,91):** debajo de la frase, que sigue como se oyó.
- **Observación del filtro de habla:** la decisión que llegó después del turno, como "la persona
  había terminado la idea". No cambió nada.
- **El filtro de habla no respondió en el plazo**, o **no leyó esta frase** (con el motivo, como la
  clave ausente): la llamada siguió sin él.
