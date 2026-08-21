import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import { getCurrentRate } from '@/backend/services/exchange-rate.service';
import { PrintOnLoad } from '@/frontend/features/admin/PrintOnLoad';

/**
 * ===========================================================================
 *  /imprimir/factura/{id} — el papel que se le entrega al paciente
 * ===========================================================================
 *  Vive FUERA del grupo `(admin)` a propósito.
 *
 *  Ese layout mete la barra lateral y la superior, y una hoja de impresión no
 *  puede llevar el menú del panel: la primera versión estaba dentro y el
 *  papel salía con «Inicio · Agenda · WhatsApp» encima de los datos del
 *  paciente. Esconderlo con CSS de impresión lo habría tapado, pero el HTML
 *  seguiría ahí y cualquier descuido lo devolvería.
 *
 *  Se abre en pestaña nueva y lanza el diálogo de impresión sola.
 *
 *  NO es una factura fiscal: no lleva numeración del SENIAT, ni RIF del
 *  cliente, ni IVA desglosado. Es el comprobante interno de la clínica, y por
 *  eso lo dice en el pie — para que nadie la presente como lo que no es.
 * ===========================================================================
 */

export const metadata = { title: 'Imprimir factura' };
export const dynamic = 'force-dynamic';

export default async function PrintInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('ASSISTANT');

  const { id } = await params;
  const [invoice, settings] = await Promise.all([
    repository.getInvoice(id),
    repository.getClinicSettings(),
  ]);
  if (!invoice) notFound();

  const rateSource = settings.preferredRateSource === 'PARALELO' ? 'PARALELO' : 'BCV';
  const rate = await getCurrentRate(rateSource);

  const fecha = new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Caracas',
  }).format(invoice.issuedAt);

  return (
    <main className="print-sheet">
      <PrintOnLoad />

      <header className="print-sheet__head">
        <div>
          <h1 className="print-sheet__clinic">{settings.clinicName}</h1>
          {settings.taxId && <p className="print-sheet__meta">RIF {settings.taxId}</p>}
          {settings.address && <p className="print-sheet__meta">{settings.address}</p>}
          {settings.phone && <p className="print-sheet__meta">{settings.phone}</p>}
        </div>
        <div className="print-sheet__number">
          <div className="print-sheet__number-label">Factura</div>
          <div className="print-sheet__number-value">Nº {invoice.number}</div>
          <div className="print-sheet__meta">{fecha}</div>
        </div>
      </header>

      <section className="print-sheet__party">
        <div>
          <span className="print-sheet__label">Paciente</span>
          <div className="print-sheet__strong">{invoice.patientName}</div>
        </div>
        {invoice.dentistName && (
          <div>
            <span className="print-sheet__label">Atendido por</span>
            <div>{invoice.dentistName}</div>
          </div>
        )}
      </section>

      <table className="print-sheet__table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="print-sheet__num">Cant.</th>
            <th className="print-sheet__num">Precio</th>
            <th className="print-sheet__num">Desc.</th>
            <th className="print-sheet__num">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.description}
                {/*
                  El motivo de la rebaja va EN EL PAPEL: el paciente tiene que
                  poder ver por qué se le descontó, no sólo que se le descontó.
                */}
                {line.discountReason && (
                  <div className="print-sheet__note">{line.discountReason}</div>
                )}
              </td>
              <td className="print-sheet__num">{line.quantity}</td>
              <td className="print-sheet__num">{formatCents(line.unitPriceCents)}</td>
              <td className="print-sheet__num">
                {line.discountCents > 0 ? `−${formatCents(line.discountCents)}` : '—'}
              </td>
              <td className="print-sheet__num">{formatCents(line.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="print-sheet__totals">
        <div className="print-sheet__total-row">
          <span>Subtotal</span>
          <span>{formatCents(invoice.subtotalCents)}</span>
        </div>
        {invoice.discountCents > 0 && (
          <div className="print-sheet__total-row">
            <span>Descuentos</span>
            <span>−{formatCents(invoice.discountCents)}</span>
          </div>
        )}
        <div className="print-sheet__total-row print-sheet__total-row--strong">
          <span>Total</span>
          <span>{formatCents(invoice.totalCents)}</span>
        </div>
        {rate && (
          <div className="print-sheet__total-row">
            <span>Equivalente en bolívares</span>
            <span>{formatBs(centsToBs(invoice.totalCents, rate.rate))}</span>
          </div>
        )}
      </section>

      {invoice.payments.length > 0 && (
        <section className="print-sheet__payments">
          <div className="print-sheet__label">Cobros recibidos</div>
          {invoice.payments.map((p) => (
            <div className="print-sheet__total-row" key={p.id}>
              <span>
                {new Intl.DateTimeFormat('es-VE', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'America/Caracas',
                }).format(p.paidAt)}{' '}
                · {p.methodLabel ?? p.method}
              </span>
              <span>{formatCents(p.amountCents)}</span>
            </div>
          ))}

          {/*
            El saldo se imprime cuando queda algo por cobrar: es la razón por
            la que el paciente se lleva este papel de un pago en dos partes.
          */}
          {invoice.balanceCents > 0 && (
            <div className="print-sheet__total-row print-sheet__total-row--strong">
              <span>Pendiente</span>
              <span>{formatCents(invoice.balanceCents)}</span>
            </div>
          )}
        </section>
      )}

      <footer className="print-sheet__foot">
        Documento interno de control. No es una factura fiscal.
      </footer>
    </main>
  );
}
