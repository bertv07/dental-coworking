-- ===========================================================================
--  Facturas de recepción
-- ===========================================================================
--  «Que se haga factura.» NO es una factura fiscal: no lleva numeración del
--  SENIAT, ni RIF obligatorio, ni IVA desglosado. Es el comprobante interno
--  de la clínica — lo que se le entrega al paciente y lo que recepción edita
--  cuando en la consulta se hace algo más de lo previsto.
--
--  Si algún día hace falta la fiscal, esto NO se convierte en ella: se emite
--  aparte y se enlaza. Mezclarlas obligaría a que un documento interno
--  cumpliera reglas legales que hoy nadie le está pidiendo.
--
--  ---------------------------------------------------------------------
--  POR QUÉ LA FACTURA Y NO EL PAGO
--  ---------------------------------------------------------------------
--  Hasta ahora `payments` tenía `appointmentId UNIQUE`: un cobro por cita, de
--  una vez. Eso impide las dos cosas que pidió la clínica:
--
--   · Pagar en dos partes — hacen falta varios pagos sobre lo mismo.
--   · Editar lo cobrado — hace falta un documento con líneas, no un importe.
--
--  La factura es ese documento. El pago pasa a ser «dinero que entró contra
--  esta factura», que es lo que de verdad es.
-- ===========================================================================

CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

CREATE TABLE "invoices" (
  "id" TEXT NOT NULL,

  -- Correlativo interno, legible para el paciente («Factura Nº 128»).
  -- Lo da una secuencia: dos recepcionistas cobrando a la vez no pueden
  -- sacar el mismo número.
  "number" INTEGER NOT NULL,

  "patientId" TEXT NOT NULL,

  -- Odontólogo al que se le reparte. Va en la factura y no sólo en la cita
  -- porque puede haber venta sin cita (una radiografía suelta, por ejemplo).
  "dentistId" TEXT,

  -- Cita de origen, si la hubo. Sin `UNIQUE`: una cita larga puede acabar
  -- facturada en dos documentos si el paciente lo pide así.
  "appointmentId" TEXT,

  "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',

  -- Totales en CENTAVOS DE DÓLAR, como todo el dinero del sistema.
  -- Se recalculan desde las líneas en cada cambio; nunca se editan a mano.
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents"    INTEGER NOT NULL DEFAULT 0,

  -- Reparto del TOTAL, calculado línea a línea. Se congela al emitir.
  -- Cada pago toma su parte proporcional de aquí.
  "clinicShareCents"  INTEGER NOT NULL DEFAULT 0,
  "dentistShareCents" INTEGER NOT NULL DEFAULT 0,

  "notes" TEXT,

  "issuedByUserId" TEXT,
  "issuedAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Anulada: no se borra, se marca. Una factura entregada existió.
  "voidedAt"  TIMESTAMPTZ(3),
  "voidReason" TEXT,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE INDEX "invoices_patientId_idx" ON "invoices"("patientId");
CREATE INDEX "invoices_status_issuedAt_idx" ON "invoices"("status", "issuedAt");
CREATE INDEX "invoices_appointmentId_idx" ON "invoices"("appointmentId");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL: si se borra la ficha del odontólogo, la factura del paciente NO
-- puede desaparecer con él.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los importes no pueden ser negativos, y el total tiene que cuadrar con
-- subtotal menos descuento. Es la invariante del documento: si alguna vez no
-- se cumple, el papel que se le dio al paciente no dice lo que se le cobró.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_positive"
  CHECK ("subtotalCents" >= 0 AND "discountCents" >= 0 AND "totalCents" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_matches"
  CHECK ("totalCents" = "subtotalCents" - "discountCents");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_split_matches"
  CHECK ("clinicShareCents" + "dentistShareCents" = "totalCents");

-- La secuencia del correlativo. Arranca en 1000 para que los números no
-- parezcan de prueba desde el primer día.
CREATE SEQUENCE "invoice_number_seq" START 1000;

-- ---------------------------------------------------------------------------
--  Líneas
-- ---------------------------------------------------------------------------
CREATE TABLE "invoice_lines" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,

  -- El tratamiento del catálogo, si la línea salió de ahí. NULL para una
  -- línea escrita a mano.
  "treatmentId" TEXT,

  -- Descripción CONGELADA. Se copia y no se lee del catálogo: si mañana se
  -- renombra el tratamiento, la factura de ayer debe seguir diciendo lo que
  -- decía cuando se entregó.
  "description" TEXT NOT NULL,

  "quantity"       INTEGER NOT NULL DEFAULT 1,
  "unitPriceCents" INTEGER NOT NULL,

  -- Descuento de ESTA línea, en centavos. Lo marca recepción a mano.
  --
  -- Cubre el caso que pidió la clínica: «si haces esto, esto va gratis». No
  -- es gratis de verdad —el precio de lo otro sube— así que se guardan las
  -- dos cosas: el precio real de cada cosa y cuánto se rebajó. Un simple
  -- «línea a $0» perdería para siempre cuánto se regaló.
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  -- Por qué se rebajó. Sin esto, a fin de mes nadie sabe qué se regaló ni a
  -- cambio de qué.
  "discountReason" TEXT,

  -- Comisión de la clínica en esta línea, copiada al añadirla. Es lo que
  -- permite que una radiografía (100 % clínica) conviva con una limpieza
  -- (40/60) en la misma factura.
  "commissionPercent" INTEGER NOT NULL,

  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_treatmentId_fkey"
  FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amounts"
  CHECK (
    "quantity" > 0
    AND "unitPriceCents" >= 0
    AND "discountCents" >= 0
    -- No se puede descontar más de lo que vale la línea: el resultado sería
    -- una línea que le devuelve dinero al paciente sin que nadie lo decida.
    AND "discountCents" <= "unitPriceCents" * "quantity"
    AND "commissionPercent" BETWEEN 0 AND 100
  );

-- ---------------------------------------------------------------------------
--  El pago pasa a colgar de la factura
-- ---------------------------------------------------------------------------

ALTER TABLE "payments" ADD COLUMN "invoiceId" TEXT;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- ---------------------------------------------------------------------------
--  Traer el histórico: una factura por cada cobro que ya existe
-- ---------------------------------------------------------------------------
--  Sin esto habría dos mundos —cobros viejos sueltos y cobros nuevos con
--  factura— y cada consulta del panel tendría que mirar en los dos. Se
--  convierte el pasado al modelo nuevo y queda un solo camino.
--
--  Los ids se generan con forma de cuid ('c' + hex) para que pasen la misma
--  validación que los que crea la aplicación.

INSERT INTO "invoices" (
  "id", "number", "patientId", "dentistId", "appointmentId", "status",
  "subtotalCents", "discountCents", "totalCents",
  "clinicShareCents", "dentistShareCents",
  "notes", "issuedAt", "createdAt", "updatedAt"
)
SELECT
  'c' || substr(md5(random()::text || p.id), 1, 24),
  nextval('invoice_number_seq'),
  a."patientId",
  a."dentistId",
  a.id,
  CASE WHEN p.status = 'PAID' THEN 'PAID'::"InvoiceStatus" ELSE 'OPEN'::"InvoiceStatus" END,
  p."amountCents",
  0,
  p."amountCents",
  p."clinicShareCents",
  p."dentistShareCents",
  'Generada al migrar los cobros anteriores a facturas.',
  COALESCE(p."paidAt", p."createdAt"),
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "payments" p
JOIN "appointments" a ON a.id = p."appointmentId";

-- Una línea por factura, con el nombre del tratamiento congelado.
INSERT INTO "invoice_lines" (
  "id", "invoiceId", "treatmentId", "description",
  "quantity", "unitPriceCents", "discountCents", "commissionPercent", "sortOrder"
)
SELECT
  'c' || substr(md5(random()::text || i.id), 1, 24),
  i.id,
  a."treatmentId",
  t.name,
  1,
  i."totalCents",
  0,
  p."commissionPercentApplied",
  0
FROM "invoices" i
JOIN "appointments" a ON a.id = i."appointmentId"
JOIN "treatments"   t ON t.id = a."treatmentId"
JOIN "payments"     p ON p."appointmentId" = a.id;

-- Y cada pago queda enganchado a su factura.
UPDATE "payments" p
SET "invoiceId" = i.id
FROM "invoices" i
WHERE i."appointmentId" = p."appointmentId"
  AND p."invoiceId" IS NULL;

-- ---------------------------------------------------------------------------
--  Se levanta el candado de «un pago por cita»
-- ---------------------------------------------------------------------------
--  Era exactamente lo que impedía cobrar en dos partes. A partir de ahora la
--  regla no es «un pago por cita» sino «la suma de los pagos no pasa del
--  total de la factura», y eso se comprueba en la transacción de cobro.
DROP INDEX IF EXISTS "payments_appointmentId_key";
ALTER TABLE "payments" ALTER COLUMN "appointmentId" DROP NOT NULL;
CREATE INDEX "payments_appointmentId_idx" ON "payments"("appointmentId");
