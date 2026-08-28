-- ===========================================================================
--  PROMOCIONES
-- ===========================================================================
--  «Si te haces la limpieza, la consulta va gratis.»
--
--  NO descuentan solas. El descuento de la factura lo sigue marcando recepcion
--  a mano, como pidio la clinica. Esta tabla es lo que se OFRECE: la usa el
--  bot para proponerla por WhatsApp y recepcion para saber que una factura
--  cumple una promocion antes de cobrar.
-- ===========================================================================

CREATE TYPE "PromotionBenefit" AS ENUM ('FREE_TREATMENT', 'PERCENT_OFF', 'AMOUNT_OFF');

CREATE TABLE "promotions" (
  "id"                     TEXT PRIMARY KEY,
  "name"                   TEXT NOT NULL,
  "description"            TEXT,
  "requiredTreatmentCodes" TEXT[] NOT NULL DEFAULT '{}',
  "benefitKind"            "PromotionBenefit" NOT NULL DEFAULT 'PERCENT_OFF',
  "benefitTreatmentCode"   TEXT,
  "benefitValue"           INTEGER NOT NULL DEFAULT 0,
  "botPitch"               TEXT,
  "startsAt"               TIMESTAMPTZ(3),
  "endsAt"                 TIMESTAMPTZ(3),
  "isActive"               BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByUserId"        TEXT,
  "createdAt"              TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "deletedAt"              TIMESTAMPTZ(3),

  -- Un porcentaje fuera de 0-100 no es un descuento, es un error de entrada
  -- que acabaria regalando dinero o cobrando de mas.
  CONSTRAINT "promotions_percent_check"
    CHECK ("benefitKind" <> 'PERCENT_OFF' OR ("benefitValue" BETWEEN 1 AND 100)),

  -- Un tratamiento gratis sin decir cual no se puede ni enunciar.
  CONSTRAINT "promotions_free_needs_code"
    CHECK ("benefitKind" <> 'FREE_TREATMENT' OR "benefitTreatmentCode" IS NOT NULL),

  -- Una vigencia que termina antes de empezar no la cumple nadie.
  CONSTRAINT "promotions_dates_check"
    CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE INDEX "promotions_active_idx" ON "promotions" ("isActive", "deletedAt");
