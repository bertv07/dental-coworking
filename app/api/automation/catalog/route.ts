import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { getCurrentRate } from '@/backend/services/exchange-rate.service';
import { centsToBs } from '@/backend/domain/money';
import { ok, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/catalog
 * ===========================================================================
 *  TODO LO QUE EL BOT NECESITA SABER DE LA CLÍNICA, EN UNA SOLA LLAMADA.
 *
 *  Este endpoint es lo que hace que el panel y la automatización no se
 *  desincronicen. La regla es:
 *
 *      EL BOT NO SABE NADA DE MEMORIA.
 *
 *  Ni los precios, ni los nombres de los tratamientos, ni quién trabaja en la
 *  clínica, ni el horario. Todo se consulta aquí al empezar la conversación.
 *  Si alguien sube la ortodoncia de $350 a $380 en `/tratamientos`, la
 *  siguiente respuesta del bot ya dice $380 — sin tocar el flujo de n8n.
 *
 *  El error que esto evita: hardcodear la lista de precios en el prompt del
 *  modelo. Funciona el primer día y a la semana el bot está cotizando
 *  precios viejos, agendando con un odontólogo que ya no está o citando en
 *  un consultorio cerrado. Y nadie se entera hasta que llega el paciente.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ POST PARA UNA LECTURA
 *  ---------------------------------------------------------------------
 *  Igual que en /availability: la firma HMAC cubre el cuerpo. Firmar una
 *  query string es más frágil (orden de parámetros, codificación) y deja
 *  datos en los logs de acceso de cualquier proxy intermedio.
 *
 *  El cuerpo puede ser `{}`. Se firma igual.
 *
 *  ---------------------------------------------------------------------
 *  RESPUESTA
 *  ---------------------------------------------------------------------
 *  {
 *    "ok": true,
 *    "data": {
 *      "clinic":     { "name", "phone", "address", "timezone",
 *                      "opensAt": "08:00", "closesAt": "18:00" },
 *      "currency":   { "base": "USD", "rate": 771.07, "source": "BCV",
 *                      "fetchedAt": "..." },
 *      "treatments": [ { "code", "name", "description", "durationMinutes",
 *                        "priceUsd", "priceCents", "priceBs" } ],
 *      "dentists":   [ { "id", "name", "specialties" } ],
 *      "rooms":      [ { "id", "code", "name" } ],
 *      "paymentMethods": [ { "label": "Pago móvil",
 *                            "kind": "TRANSFER",
 *                            "currency": "VES",
 *                            "instructions": "Banco: ...\nTeléfono: ..." } ]
 *    }
 *  }
 *
 *  Nótese lo que NO viaja: comisiones, correos y teléfonos del personal,
 *  ni nada de pacientes. El bot habla con el público; sólo recibe lo que
 *  puede decirle al público.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "480" → "08:00". El bot necesita decir la hora, no un número de minutos. */
function minuteToLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'catalog',
      kind: 'read',
      requestId,
    });
    if (!signed.ok) return signed.response;

    // No hay parámetros que validar: el catálogo es el mismo para todos.
    const [settings, treatments, dentists, rooms, paymentMethods, agreements] =
      await Promise.all([
        repository.getClinicSettings(),
        repository.listTreatments(),
        repository.listDentists(),
        repository.listRooms(),
        repository.listPaymentMethods(),
        /*
         * Tarifas pactadas, SÓLO las aprobadas.
         *
         * Es la misma regla que aplica el cobro: una propuesta pendiente no
         * cambia lo que se paga. Si el bot cotizara una tarifa sin aprobar,
         * el paciente oiría un precio y en el mostrador le cobrarían otro.
         */
        repository.listDentistTreatments({ status: 'APPROVED' }),
      ]);

    const rateSource = settings.preferredRateSource === 'PARALELO' ? 'PARALELO' : 'BCV';
    const rate = await getCurrentRate(rateSource);

    /*
     * Índice por id para resolver el código y la variabilidad de cada tarifa
     * pactada sin recorrer la lista entera por acuerdo.
     *
     * `listTreatments()` sin `includeInactive` sólo trae los activos, así que
     * un acuerdo sobre un tratamiento retirado no encuentra pareja y se
     * descarta más abajo — que es justo lo que se quiere.
     */
    const treatmentById = new Map(treatments.map((treatment) => [treatment.id, treatment]));

    return ok({
      clinic: {
        name: settings.clinicName,
        phone: settings.phone,
        address: settings.address,
        timezone: 'America/Caracas',
        opensAt: minuteToLabel(settings.openingMinute),
        closesAt: minuteToLabel(settings.closingMinute),
        slotMinutes: settings.slotMinutes,
      },

      /*
       * Se manda el precio en las TRES formas: centavos (exacto, para
       * cálculos), dólares (legible) y bolívares (lo que el paciente paga).
       *
       * Convertir a bolívares en el bot sería pedirle a un modelo de lenguaje
       * que multiplique — y de vez en cuando se equivoca. Aquí el número sale
       * calculado y ya.
       */
      currency: {
        base: 'USD',
        quote: 'VES',
        rate: rate?.rate ?? null,
        source: rate?.source ?? rateSource,
        fetchedAt: rate?.fetchedAt?.toISOString() ?? null,
        // Si es `true`, el bot debe evitar dar precios en bolívares y decir
        // que los confirme recepción.
        stale: rate === null,
      },

      treatments: treatments.map((treatment) => ({
        // El CÓDIGO es la llave estable con la que se agenda. Renombrar
        // "Limpieza" a "Profilaxis" en el panel no rompe el flujo de n8n.
        code: treatment.code,
        name: treatment.name,
        description: treatment.description,
        durationMinutes: treatment.durationMinutes,
        priceCents: treatment.basePriceCents,
        priceUsd: treatment.basePriceCents / 100,
        priceBs: rate ? centsToBs(treatment.basePriceCents, rate.rate) : null,
        /*
         * Precio orientativo: el bot debe cotizar «desde $X» en vez de un
         * precio cerrado. Es el caso del tratamiento de conducto, que depende
         * de cuántos conductos tenga la pieza — y eso no se sabe hasta ver la
         * radiografía.
         */
        isPriceVariable: treatment.isPriceVariable,
      })),

      /*
       * Cada odontólogo con SUS precios pactados, cuando los tiene.
       *
       * «Los precios varían de acuerdo al tratamiento, y también según el
       * odontólogo»: un cirujano con veinte años cobra la exodoncia distinto
       * que quien acaba de entrar. Sin esto el bot cotizaría siempre el
       * precio de lista y el paciente se llevaría la sorpresa al pagar.
       *
       * ⚠️  Va el PRECIO, nunca `customCommissionPercent`. Cómo se reparte
       *  ese dinero entre la clínica y el odontólogo es un acuerdo interno
       *  que no le importa al paciente, y este endpoint habla con el público.
       *  El reparto no sale de aquí porque no se selecciona, no porque el bot
       *  tenga instrucciones de callarlo.
       */
      dentists: dentists.map((dentist) => ({
        id: dentist.id,
        name: dentist.fullName,
        specialties: dentist.specialties,
        prices: agreements
          .filter(
            (agreement) =>
              agreement.dentistId === dentist.id && agreement.customPriceCents !== null,
          )
          .map((agreement) => {
            const treatment = treatmentById.get(agreement.treatmentId);
            const priceCents = agreement.customPriceCents as number;

            return {
              // El código, no el id: es la llave estable con la que se agenda.
              code: treatment?.code ?? null,
              name: agreement.treatmentName,
              priceCents,
              priceUsd: priceCents / 100,
              priceBs: rate ? centsToBs(priceCents, rate.rate) : null,
              // Un precio pactado sobre un tratamiento variable sigue siendo
              // orientativo: el conducto depende de la pieza, no de quién lo
              // haga.
              isPriceVariable: treatment?.isPriceVariable ?? false,
            };
          })
          // Un acuerdo sobre un tratamiento desactivado no se puede agendar:
          // ofrecerlo sería cotizar algo que luego no se puede reservar.
          .filter((price) => price.code !== null),
      })),

      rooms: rooms.map((room) => ({ id: room.id, code: room.code, name: room.name })),

      /*
       * Cómo se paga. Sale de `/configuracion`, no del prompt del bot.
       *
       * Si estos datos vivieran en el flujo de n8n, el día que la clínica
       * cambie de banco el bot seguiría mandando a los pacientes a la cuenta
       * vieja hasta que alguien se acordara de editarlo. Aquí lo cambia el
       * administrador y la siguiente conversación ya usa lo nuevo.
       *
       * `kind` viaja para que el bot pueda decir "en recepción" cuando es
       * efectivo o tarjeta, en vez de dictar unos datos que no existen.
       */
      paymentMethods: paymentMethods.map((method) => ({
        label: method.label,
        kind: method.kind,
        currency: method.currency,
        instructions: method.instructions,
      })),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
