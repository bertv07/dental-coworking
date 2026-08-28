-- ===========================================================================
--  REPARTO 60 / 40 Y CUMPLEANOS DEL PERSONAL
-- ===========================================================================
--  1. El reparto de la clinica pasa a ser 60 % clinica / 40 % odontologo.
--
--     `clinicCommissionPercent` es SIEMPRE la parte de la CLINICA. Estaba en
--     40, que significaba justo lo contrario de lo que la clinica queria: el
--     odontologo se llevaba el 60 %.
--
--     Se cambian los que estaban en el valor por defecto viejo (40). Los que
--     tienen un porcentaje negociado aparte (35, 38, 42, 45...) NO se tocan:
--     son acuerdos individuales y machacarlos cambiaria lo que se le paga a
--     alguien sin que nadie lo haya decidido.
--
--     Los pagos YA registrados no se mueven: cada uno guarda el reparto que
--     se le aplico (ver nota 4 del esquema).
--
--  2. Fecha de nacimiento del personal, para saber a quien felicitar.
-- ===========================================================================

ALTER TABLE "clinic_settings"
  ALTER COLUMN "defaultCommissionPercent" SET DEFAULT 60;

UPDATE "clinic_settings"
   SET "defaultCommissionPercent" = 60
 WHERE "defaultCommissionPercent" = 40;

UPDATE "dentists"
   SET "clinicCommissionPercent" = 60
 WHERE "clinicCommissionPercent" = 40
   AND "deletedAt" IS NULL;

ALTER TABLE "dentists" ADD COLUMN "birthDate" DATE;
ALTER TABLE "users"    ADD COLUMN "birthDate" DATE;
