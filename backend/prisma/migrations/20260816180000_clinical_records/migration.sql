-- Expediente clínico.
--
-- Un expediente por paciente. Puede existir VACÍO: se crea al imprimirlo en
-- blanco, antes de que el odontólogo lo haya rellenado a mano. Por eso casi
-- todo es nullable — exigir los campos al crearlo haría imposible el primer
-- paso del proceso.
CREATE TABLE "clinical_records" (
  "id"                 TEXT NOT NULL,
  "patientId"          TEXT NOT NULL,
  "hypertension"       BOOLEAN NOT NULL DEFAULT false,
  "diabetes"           BOOLEAN NOT NULL DEFAULT false,
  "heartDisease"       BOOLEAN NOT NULL DEFAULT false,
  "anticoagulants"     BOOLEAN NOT NULL DEFAULT false,
  "pregnant"           BOOLEAN NOT NULL DEFAULT false,
  "allergies"          TEXT,
  "currentMedications" TEXT,
  "medicalNotes"       TEXT,
  "chiefComplaint"     TEXT,
  "odontogram"         JSONB,
  "treatmentPlan"      TEXT,
  "createdByUserId"    TEXT,
  "updatedByUserId"    TEXT,
  "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"          TIMESTAMPTZ(3),
  CONSTRAINT "clinical_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_records_patientId_key" ON "clinical_records"("patientId");

ALTER TABLE "clinical_records"
  ADD CONSTRAINT "clinical_records_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hoja de evolución: una línea por atención.
--
-- Va en tabla aparte porque crece sin límite — un paciente de ortodoncia
-- acumula decenas de entradas sobre el mismo expediente.
CREATE TABLE "clinical_entries" (
  "id"              TEXT NOT NULL,
  "recordId"        TEXT NOT NULL,
  -- La fecha del PAPEL, que puede no ser la de hoy: la asistente transcribe
  -- expedientes con días de retraso.
  "performedOn"     TIMESTAMPTZ(3) NOT NULL,
  "dentistId"       TEXT,
  "appointmentId"   TEXT,
  "procedure"       TEXT NOT NULL,
  -- Piezas tratadas en notación FDI: {"16","17"}.
  "teeth"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"           TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "clinical_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_entries_appointmentId_key" ON "clinical_entries"("appointmentId");
CREATE INDEX "clinical_entries_recordId_performedOn_idx" ON "clinical_entries"("recordId", "performedOn");
CREATE INDEX "clinical_entries_dentistId_performedOn_idx" ON "clinical_entries"("dentistId", "performedOn");

ALTER TABLE "clinical_entries"
  ADD CONSTRAINT "clinical_entries_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "clinical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `SET NULL` y no `CASCADE`: si se borra la ficha de un odontólogo, la
-- historia clínica del paciente NO puede desaparecer con él.
ALTER TABLE "clinical_entries"
  ADD CONSTRAINT "clinical_entries_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clinical_entries"
  ADD CONSTRAINT "clinical_entries_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
