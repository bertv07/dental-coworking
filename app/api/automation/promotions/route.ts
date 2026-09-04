import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { formatCents } from '@/backend/domain/money';
import { ok, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/promotions
 * ===========================================================================
 *  LAS PROMOCIONES VIGENTES, PARA QUE EL BOT LAS OFREZCA.
 *
 *  «Si te haces la limpieza, la consulta va gratis.» El bot puede decirlo
 *  cuando alguien pregunta el precio, en vez de soltar la tarifa a secas.
 *
 *  ---------------------------------------------------------------------
 *  SÓLO LAS VIGENTES
 *  ---------------------------------------------------------------------
 *  Se filtran por fecha aquí y no en el flujo de n8n. Una promoción que
 *  terminó ayer y que el bot sigue ofreciendo se convierte en una discusión
 *  en el mostrador, y la clínica acaba respetándola por no discutir. Que la
 *  vigencia dependa de que alguien se acuerde de tocar el flujo es pedir que
 *  eso pase.
 *
 *  ---------------------------------------------------------------------
 *  EL BOT NO CALCULA EL DESCUENTO
 *  ---------------------------------------------------------------------
 *  Cada promoción viene con `pitch`: una frase ya redactada para decirla tal
 *  cual. El bot OFRECE; quien aplica el descuento es recepción al facturar.
 *  Si el bot cerrara el precio final, dos promociones a la vez o un caso raro
 *  acabarían en un importe que nadie puede sostener en el mostrador.
 *
 *  CUERPO: `{}` — no hay parámetros. Firma HMAC como el resto.
 *
 *  RESPUESTA
 *    { "promotions": [ {
 *        "name", "description",
 *        "requiredTreatments": ["LIMPIEZA"],   // qué tiene que hacerse
 *        "benefit": { "kind": "FREE_TREATMENT", "treatment": "CONSULTA",
 *                     "label": "la consulta sale gratis" },
 *        "pitch": "Si te haces la limpieza, la consulta va incluida.",
 *        "endsAt": "2026-09-30T00:00:00.000Z" | null
 *    } ] }
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'promotions',
      kind: 'read',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const [promociones, treatments] = await Promise.all([
      repository.listPromotions({ soloVigentes: true }),
      repository.listTreatments(),
    ]);

    const nombrePorCodigo = new Map(treatments.map((t) => [t.code, t.name]));

    return ok({
      promotions: promociones.map((p) => {
        const nombreBeneficio = p.benefitTreatmentCode
          ? (nombrePorCodigo.get(p.benefitTreatmentCode) ?? p.benefitTreatmentCode)
          : null;

        /*
         * La etiqueta se arma aquí para que el bot no tenga que interpretar
         * un enum y un número. Cuanto menos lógica de negocio viva en el
         * flujo de n8n, menos sitios hay que tocar cuando esto cambie.
         */
        const nombresIncluidos = p.requiredTreatmentCodes
          .map((c) => nombrePorCodigo.get(c) ?? c)
          .join(' + ');

        const label =
          p.benefitKind === 'FREE_TREATMENT'
            ? `${nombreBeneficio} sale gratis`
            : p.benefitKind === 'PERCENT_OFF'
              ? `${p.benefitValue} % de descuento`
              : p.benefitKind === 'PACKAGE_PRICE'
                ? `${nombresIncluidos} por ${formatCents(p.benefitValue)} el paquete completo`
                : `${formatCents(p.benefitValue)} de descuento`;

        return {
          name: p.name,
          description: p.description,
          requiredTreatments: p.requiredTreatmentCodes,
          requiredTreatmentNames: p.requiredTreatmentCodes.map(
            (c) => nombrePorCodigo.get(c) ?? c,
          ),
          benefit: {
            kind: p.benefitKind,
            treatment: p.benefitTreatmentCode,
            treatmentName: nombreBeneficio,
            value: p.benefitValue,
            label,
          },
          // Si nadie escribió una frase, se redacta una con lo que hay: es
          // preferible a que el bot improvise con los campos sueltos.
          pitch:
            p.botPitch ??
            (p.benefitKind === 'PACKAGE_PRICE'
              ? `${label}.`
              : p.requiredTreatmentCodes.length > 0
                ? `Si te haces ${p.requiredTreatmentCodes
                    .map((c) => nombrePorCodigo.get(c) ?? c)
                    .join(' y ')}, ${label}.`
                : `${p.name}: ${label}.`),
          endsAt: p.endsAt ? p.endsAt.toISOString() : null,
        };
      }),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
