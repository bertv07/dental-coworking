-- Foto de la caja: el paciente la reconoce en la farmacia aunque no sepa leer
-- el principio activo.
ALTER TABLE "medications" ADD COLUMN "imageContent" BYTEA;
ALTER TABLE "medications" ADD COLUMN "imageMimeType" TEXT;
