-- Bonificación a favor del paciente (lo que pagó de más y quedó a su
-- favor para una factura futura).
ALTER TABLE "patients" ADD COLUMN "creditBalanceCents" INTEGER NOT NULL DEFAULT 0;
