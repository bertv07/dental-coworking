-- Odontólogo de preferencia del paciente.
--
-- Se le pregunta al terminar una cita si quiere que las próximas sean con el
-- mismo. Mientras esté puesto, el bot sólo le ofrece huecos de esa persona.
--
-- Dos columnas y no una: `preferredDentistId` NULL significa «sin
-- preferencia», y sin `preferredDentistAskedAt` sería indistinguible de
-- «todavía no le hemos preguntado» — se le preguntaría en cada visita.
ALTER TABLE "patients" ADD COLUMN "preferredDentistId" TEXT;
ALTER TABLE "patients" ADD COLUMN "preferredDentistAskedAt" TIMESTAMPTZ(3);

-- SET NULL: dar de baja a un odontólogo no puede borrar a sus pacientes.
-- Se quedan sin preferencia, que es exactamente lo que ha pasado.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_preferredDentistId_fkey"
  FOREIGN KEY ("preferredDentistId") REFERENCES "dentists"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "patients_preferredDentistId_idx" ON "patients"("preferredDentistId");
