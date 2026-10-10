-- Porcentaje de la clínica PROPIO de un tratamiento, editable desde Precios.
-- NULL = sin porcentaje propio: manda el de la odontóloga o el de la clínica,
-- como hasta ahora. Ningún tratamiento existente cambia de reparto.
ALTER TABLE "treatments" ADD COLUMN "clinicCommissionPercent" INTEGER;
ALTER TABLE "treatments"
  ADD CONSTRAINT "treatments_clinicCommissionPercent_check"
  CHECK ("clinicCommissionPercent" IS NULL OR "clinicCommissionPercent" BETWEEN 0 AND 100);
