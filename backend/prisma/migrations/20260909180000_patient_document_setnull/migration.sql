-- Un documento del expediente que existió no se destruye ni siquiera al
-- borrar por completo la ficha del paciente (deletePatientPermanently).
-- Antes cascadeaba con el paciente; pasa a quedar huérfano (patientId NULL).
ALTER TABLE "patient_documents" ALTER COLUMN "patientId" DROP NOT NULL;

ALTER TABLE "patient_documents" DROP CONSTRAINT "patient_documents_patientId_fkey";

ALTER TABLE "patient_documents"
  ADD CONSTRAINT "patient_documents_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
