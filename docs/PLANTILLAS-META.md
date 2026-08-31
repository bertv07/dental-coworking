# Plantillas de WhatsApp para aprobar en Meta

> Se cargan en **WhatsApp Manager → Herramientas de la cuenta → Plantillas de
> mensajes → Crear plantilla**. Copia el nombre, la categoría y el cuerpo tal
> cual; los ejemplos son obligatorios o Meta rechaza la plantilla.
>
> Idioma de todas: **Español (es)**.

---

## Por qué hacen falta

WhatsApp deja escribir libremente **sólo dentro de las 24 horas** siguientes al
último mensaje del paciente. Pasada esa ventana, el único mensaje que se puede
enviar es una **plantilla aprobada por Meta**.

Es decir: el bot puede contestar todo lo que quiera mientras el paciente esté
escribiendo, pero **recordar una cita de mañana a alguien que habló la semana
pasada exige plantilla**. Sin plantillas aprobadas, esos recordatorios
sencillamente no salen.

## Las tres reglas que hacen que te rechacen o te bloqueen

1. **La categoría tiene que ser la de verdad.** Un recordatorio de cita es
   `UTILITY`. Una oferta es `MARKETING`, aunque la escribas con cara de aviso.
   Meta lo revisa y colar promociones como utilidad es la vía rápida a que te
   limiten la cuenta.

2. **Marketing sólo a quien lo autorizó.** El sistema guarda ese permiso por
   paciente (`marketingConsent`). Las plantillas de promoción y cumpleaños de
   abajo **sólo se envían a quien lo tenga en `true`**; el resto no las recibe
   aunque encaje el criterio.

3. **Cada bloqueo cuenta.** Si la gente marca «bloquear» o «reportar», Meta
   baja la calidad del número y acaba limitando cuántos mensajes puedes
   iniciar al día. Por eso todas las de marketing llevan cómo darse de baja.

---

## 1. `recordatorio_cita` · UTILITY

El día antes de la cita.

```
Hola {{1}}, te recordamos tu cita en Dental Coworking:

📅 {{2}} a las {{3}}
🦷 {{4}}
👩‍⚕️ {{5}}

Estamos al frente del Metro de Los Cortijos, Centro Empresarial Don Bosco, piso PH, oficina PH.

Si no puedes asistir, respóndenos a este mensaje y lo reprogramamos.
```

**Ejemplos para Meta**
| Variable | Ejemplo |
|---|---|
| {{1}} | María Fernanda |
| {{2}} | martes 2 de septiembre |
| {{3}} | 3:00 p. m. |
| {{4}} | Consulta y valoración |
| {{5}} | Dra. Gabriela Ferreira |

---

## 2. `confirmacion_cita` · UTILITY

Al quedar agendada, si el paciente ya no está dentro de la ventana de 24 h.

```
{{1}}, tu cita en Dental Coworking quedó agendada para el {{2}} a las {{3}} con {{4}}.

El tratamiento es {{5}} y tiene un costo de {{6}}.

Cualquier cambio, respóndenos por aquí.
```

**Ejemplos para Meta**
| Variable | Ejemplo |
|---|---|
| {{1}} | Carlos Andrés |
| {{2}} | jueves 4 de septiembre |
| {{3}} | 10:30 a. m. |
| {{4}} | Dr. Andrés Perdomo |
| {{5}} | Endodoncia monorradicular |
| {{6}} | $120 (Bs 110.617,71) |

---

## 3. `cita_reprogramada` · UTILITY

```
{{1}}, tu cita en Dental Coworking cambió de fecha.

Antes: {{2}}
Ahora: {{3}} a las {{4}}

Si esa hora no te sirve, respóndenos y buscamos otra.
```

**Ejemplos:** {{1}} Ana Sofía · {{2}} lunes 1 de septiembre, 9:00 a. m. ·
{{3}} miércoles 3 de septiembre · {{4}} 11:00 a. m.

---

## 4. `presupuesto_listo` · UTILITY

```
{{1}}, ya tenemos listo tu presupuesto de {{2}} en Dental Coworking.

Total: {{3}}

Se puede pagar en dos partes. Respóndenos por aquí y te explicamos cómo.
```

**Ejemplos:** {{1}} Luisa Fernanda · {{2}} rehabilitación completa ·
{{3}} $340 (Bs 313.416,20)

---

## 5. `tratamiento_pendiente` · UTILITY

Para quien dejó un tratamiento a medias.

```
Hola {{1}}. En tu última visita a Dental Coworking quedó pendiente {{2}}.

¿Quieres que te agendemos para continuarlo? Respóndenos con el día que te
convenga.
```

**Ejemplos:** {{1}} Diego Alejandro · {{2}} la segunda sesión del aclaramiento

---

## 6. `promocion_vigente` · MARKETING ⚠️ sólo con consentimiento

```
{{1}}, en Dental Coworking tenemos esto para ti:

{{2}}

Válido hasta el {{3}}. Respóndenos para agendar.

Si no quieres recibir más promociones, respóndenos BAJA.
```

**Ejemplos:** {{1}} Juan Pablo · {{2}} Si te haces la exodoncia, la consulta de
valoración va incluida · {{3}} 30 de septiembre

> **Antes de enviarla**, comprueba que ese paciente tiene `marketingConsent` en
> `true`. Enviar promociones a quien no las autorizó es lo que hace que te
> bloqueen el número.

---

## 7. `felicitacion_cumpleanos` · MARKETING ⚠️ sólo con consentimiento

```
¡Feliz cumpleaños, {{1}}! 🎉

De parte de todo el equipo de Dental Coworking.

Si no quieres recibir más mensajes como este, respóndenos BAJA.
```

**Ejemplo:** {{1}} Valentina

---

## Cómo las usa el flujo de n8n

1. Antes de iniciar una conversación, mira si el paciente escribió en las
   últimas 24 horas. Si sí, manda texto normal; si no, plantilla.
2. Manda la plantilla por `template` con su `name` y sus parámetros en orden.
3. **Registra el envío** en el panel con `POST /api/automation/messages`
   (§3.4 del prompt) para que quede en el historial del chat. Un recordatorio
   que el paciente recibió y que en el panel no aparece hace que recepción
   llame para repetir lo mismo.
4. Cuando el paciente responda, ya estás dentro de la ventana de 24 h y el bot
   sigue con normalidad.

## Lo que NO debe salir por plantilla

- Diagnósticos, resultados o cualquier detalle clínico. Un recordatorio dice
  el tratamiento agendado; no dice lo que se encontró en la consulta.
- Deudas o cobros pendientes con nombre y monto. Eso se habla en el mostrador.
- Nada que el paciente no haya pedido y no haya autorizado.
