-- ===========================================================================
--  LA CLINICA COBRA A TASA EURO
-- ===========================================================================
--  Practica habitual en Venezuela y la que usa esta clinica: la lista de
--  precios se escribe y se guarda en DOLARES, y el cobro en bolivares se hace
--  multiplicando por la tasa del EURO del BCV.
--
--  Los cobros ya registrados no se tocan: cada `payment` guarda la tasa y la
--  fuente que se le aplicaron (nota 4 del esquema). Esto solo cambia lo que
--  se cobre de aqui en adelante.
--
--  Se revierte desde Configuracion cuando se quiera.
-- ===========================================================================

ALTER TABLE "clinic_settings"
  ALTER COLUMN "preferredRateSource" SET DEFAULT 'EURO';

UPDATE "clinic_settings"
   SET "preferredRateSource" = 'EURO'
 WHERE "preferredRateSource" = 'BCV';
