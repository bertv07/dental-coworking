import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import {
  prescriptionElementsSchema,
  type PrescriptionElement,
} from '@/backend/domain/prescription';

/**
 * ===========================================================================
 *  /imprimir/recetario/[id] — la hoja sola, lista para el papel
 * ===========================================================================
 *  Fuera del grupo (admin) a propósito: aquí NO va el menú lateral ni la
 *  barra superior. Una hoja de impresión con el menú del panel encima sale
 *  impresa con el menú del panel encima.
 *
 *  Se pinta con los MISMOS estilos en línea que el editor. Si la impresión
 *  tuviera su propia hoja de estilos, cualquier ajuste de una acabaría
 *  saliendo distinto en la otra, y la diferencia sólo se vería en el papel
 *  —cuando ya se gastó.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

const FUENTES: Record<string, string> = {
  sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

function pintar(el: PrescriptionElement, templateId: string) {
  const comun: React.CSSProperties = {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    transform: el.rot ? `rotate(${el.rot}deg)` : undefined,
  };

  switch (el.type) {
    case 'text':
      return (
        <div
          key={el.id}
          style={{
            ...comun,
            fontFamily: FUENTES[el.fontFamily],
            fontSize: el.fontSize,
            fontWeight: el.bold ? 700 : 400,
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align,
            color: el.color,
            lineHeight: el.lineHeight,
            whiteSpace: 'pre-wrap',
          }}
        >
          {el.content}
        </div>
      );
    case 'box':
      return (
        <div
          key={el.id}
          style={{
            ...comun,
            background: el.fill === 'none' ? 'transparent' : el.fill,
            border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none',
            borderRadius: el.radius,
          }}
        />
      );
    case 'ellipse':
      return (
        <div
          key={el.id}
          style={{
            ...comun,
            background: el.fill === 'none' ? 'transparent' : el.fill,
            border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none',
            borderRadius: '50%',
          }}
        />
      );
    case 'line':
      return (
        <svg key={el.id} style={{ ...comun, overflow: 'visible' }}>
          <line
            x1={0}
            y1={0}
            x2={el.w}
            y2={el.h}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'image':
      return el.assetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={el.id}
          src={`/api/recetarios/${templateId}/imagen/${el.assetId}`}
          alt=""
          style={{ ...comun, opacity: el.opacity, objectFit: 'fill' }}
        />
      ) : null;
  }
}

export default async function ImprimirRecetarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole('DENTIST');
  const { id } = await params;

  const template = await repository.getPrescriptionTemplate(id);
  if (!template) notFound();

  // La misma regla que en el editor: una odontóloga imprime el suyo y el de
  // la clínica, nunca el de otra.
  if (user.role === 'DENTIST') {
    const perfil = await repository.findDentistByUserId(user.id);
    const permitido = template.dentistId === null || template.dentistId === perfil?.id;
    if (!permitido) notFound();
  }

  const parsed = prescriptionElementsSchema.safeParse(template.elements);
  const elements = parsed.success ? parsed.data : [];

  return (
    <>
      {/*
        El tamaño de página se declara en CSS con las medidas reales de la
        hoja: sin esto, el navegador imprime en A4 y un recetario de media
        carta sale centrado en medio de un folio con márgenes enormes.
      */}
      <style>{`
        /*
         * EL TAMAÑO DE PÁGINA VA EN MILÍMETROS, NO EN PÍXELES.
         *
         * \`@page { size: 528px 816px }\` es CSS inválido: la regla admite
         * longitudes absolutas (mm, cm, in) o nombres de papel, y el navegador
         * descarta la declaración entera. El resultado era que imprimía en A4
         * vertical y el recipe salía descolocado o partido en dos hojas.
         *
         * Los píxeles del lienzo son a 96 ppp, así que 1 px = 25,4/96 mm.
         */
        @page {
          size: ${(template.widthPx * 25.4 / 96).toFixed(1)}mm ${(template.heightPx * 25.4 / 96).toFixed(1)}mm;
          margin: 0;
        }

        html, body { margin: 0; padding: 0; background: #fff; }

        @media print {
          html, body { width: ${template.widthPx}px; height: ${template.heightPx}px; }
          /*
           * Sin esto el navegador «ahorra tinta» y se come los fondos y las
           * imágenes: el membrete escaneado saldría en blanco.
           */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          width: template.widthPx,
          height: template.heightPx,
          margin: '0 auto',
          background: '#fff',
          /*
           * `hidden` recortaba cualquier elemento que asomara del borde; con
           * `clip` se recorta igual pero sin crear un contexto de scroll, que
           * era lo que añadía una segunda hoja en blanco al imprimir.
           */
          overflow: 'clip',
        }}
      >
        {elements.map((el) => pintar(el, template.id))}
      </div>
    </>
  );
}
