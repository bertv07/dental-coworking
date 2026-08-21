-- ===========================================================================
--  El expediente es un PAPEL ESCANEADO, no un formulario
-- ===========================================================================
--  Cómo funciona de verdad en la clínica:
--
--   · El expediente lo rellena EL PACIENTE, entero, a mano. Recepción no
--     transcribe nada.
--   · El consentimiento informado se FIRMA a mano.
--   · Recepción imprime el formulario en blanco, se lo da, y cuando vuelve
--     firmado lo escanea y lo anexa a la ficha del paciente.
--
--  Por eso desaparecen `clinical_records` y `clinical_entries`: eran para que
--  recepción tecleara los antecedentes, el odontograma y la evolución. Con el
--  papel firmado como original, teclearlo otra vez sólo crea una segunda
--  versión que puede contradecir a la primera — y la que vale legalmente es
--  la firmada.
--
--  Se borran sin conservar nada porque están VACÍAS: nunca llegaron a usarse.

DROP TABLE IF EXISTS "clinical_entries";
DROP TABLE IF EXISTS "clinical_records";

-- ---------------------------------------------------------------------------
--  Documentos escaneados del paciente
-- ---------------------------------------------------------------------------

CREATE TYPE "PatientDocumentKind" AS ENUM (
  'EXPEDIENTE',      -- Historia clínica rellenada por el paciente
  'CONSENTIMIENTO',  -- Consentimiento informado firmado
  'RADIOGRAFIA',
  'OTRO'
);

CREATE TABLE "patient_documents" (
  "id"        TEXT NOT NULL,
  "patientId" TEXT NOT NULL,

  "kind" "PatientDocumentKind" NOT NULL DEFAULT 'EXPEDIENTE',

  -- Nombre con el que se subió, para que recepción reconozca el archivo.
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,

  -- ---------------------------------------------------------------------
  --  EL ARCHIVO VA EN LA BASE, NO EN DISCO
  -- ---------------------------------------------------------------------
  --  Un expediente escaneado son unos cientos de KB. Guardarlo aquí tiene
  --  tres ventajas concretas para una clínica de este tamaño:
  --
  --   · Se respalda CON la base. Un `pg_dump` se lleva los expedientes; un
  --     volumen de disco hay que acordarse de copiarlo aparte, y el día que
  --     se pierda no hay expedientes que valgan.
  --   · No hay que configurar volúmenes persistentes en el despliegue, que
  --     es donde se rompen estas cosas sin que nadie se entere.
  --   · No quedan archivos huérfanos: si se borra el paciente, se va con él.
  --
  --  El coste es que la base crece. Con miles de documentos siguen siendo
  --  pocos GB — irrelevante frente a perder una historia clínica.
  "content" BYTEA NOT NULL,

  -- Qué es, en palabras de recepción («Consentimiento de endodoncia»).
  "notes" TEXT,

  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Borrado lógico: un documento clínico que existió no se destruye.
  "deletedAt" TIMESTAMPTZ(3),

  CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "patient_documents"
  ADD CONSTRAINT "patient_documents_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "patient_documents_patientId_idx"
  ON "patient_documents"("patientId") WHERE "deletedAt" IS NULL;

-- Sólo PDF e imágenes: es lo que sale de un escáner o de un teléfono. Aceptar
-- cualquier tipo convertiría la ficha del paciente en un sitio donde subir
-- ejecutables.
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_mime"
  CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'));

-- Cota de tamaño: 20 MB. Un escaneo normal no llega ni de lejos, y sin tope
-- un archivo enorme bloquearía la petición y llenaría la base.
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_size"
  CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);
