-- Medios de pago configurables desde el panel.
--
-- El enum PaymentMethod (CASH/CARD/TRANSFER/INSURANCE) es CONTABLE y se
-- queda como está. Esta tabla es lo que el paciente necesita oír: qué banco,
-- qué teléfono, qué correo. Vive en la base y no en el flujo de n8n porque
-- cambia — y un número de cuenta viejo escrito en el bot manda a los
-- pacientes a pagarle a otro.
CREATE TABLE "payment_method_options" (
  "id"           TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "kind"         "PaymentMethod" NOT NULL,
  "instructions" TEXT,
  "currency"     TEXT NOT NULL DEFAULT 'VES',
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"    TIMESTAMPTZ(3),
  CONSTRAINT "payment_method_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_method_options_isActive_sortOrder_idx"
  ON "payment_method_options"("isActive", "sortOrder");

-- Sólo las dos monedas que la clínica maneja. Sin esto, un "Bs" o un "bolívar"
-- escrito a mano rompería la conversión del catálogo en silencio.
ALTER TABLE "payment_method_options"
  ADD CONSTRAINT "payment_method_options_currency"
  CHECK ("currency" IN ('VES', 'USD'));

-- Etiqueta del medio concreto, copiada en el cobro. Copiada y no referenciada:
-- si mañana se borra el medio, el cobro de ayer debe seguir diciendo cómo se
-- pagó. Mismo criterio que el precio y la tasa congelados.
ALTER TABLE "payments" ADD COLUMN "methodLabel" TEXT;
