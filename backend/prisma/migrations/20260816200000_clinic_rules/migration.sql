-- ===========================================================================
--  Reglas reales de la clínica
-- ===========================================================================

-- Estado de todo lo que necesita el visto bueno de otra persona.
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- --- Tratamientos ----------------------------------------------------------

-- Precio de referencia, no cerrado. El conducto cuesta según cuántos conductos
-- tenga la pieza, y eso no se sabe hasta ver la radiografía: el bot debe
-- cotizar "desde $X" en vez de un precio que luego habría que desdecir.
ALTER TABLE "treatments" ADD COLUMN "isPriceVariable" BOOLEAN NOT NULL DEFAULT false;

-- La clínica se queda con el 100 %. Es el caso de la radiografía: la hace el
-- equipo de la clínica, no el odontólogo, así que repartir 40/60 sería pagarle
-- por un trabajo que no hizo.
ALTER TABLE "treatments" ADD COLUMN "clinicKeepsAll" BOOLEAN NOT NULL DEFAULT false;

-- --- Consultorios ----------------------------------------------------------

-- Dueño del consultorio, o NULL si es rotativo. Lo ajusta recepción, que es
-- quien conoce la rotación real por especialidades.
ALTER TABLE "rooms" ADD COLUMN "assignedDentistId" TEXT;

-- SET NULL: si se borra la ficha del odontólogo, el consultorio se vuelve
-- rotativo en vez de desaparecer con él.
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_assignedDentistId_fkey"
  FOREIGN KEY ("assignedDentistId") REFERENCES "dentists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "rooms_assignedDentistId_idx" ON "rooms"("assignedDentistId");

-- --- Precio por odontólogo: propone él, aprueba el administrador -----------

-- Mientras esté PENDING no se aplica y se cobra el precio de lista. Aplicarlo
-- antes significaría que cualquiera con cuenta de odontólogo puede cambiar lo
-- que se le cobra a los pacientes.
ALTER TABLE "dentist_treatments" ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "dentist_treatments" ADD COLUMN "proposedByUserId" TEXT;
ALTER TABLE "dentist_treatments" ADD COLUMN "reviewedByUserId" TEXT;
ALTER TABLE "dentist_treatments" ADD COLUMN "reviewedAt" TIMESTAMPTZ(3);
ALTER TABLE "dentist_treatments" ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "dentist_treatments" ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Lo que ya existía lo puso el administrador: nace aprobado. Dejarlo en
-- PENDING desactivaría de golpe precios que ya se estaban cobrando.
UPDATE "dentist_treatments" SET "status" = 'APPROVED';

-- El porcentaje sigue las mismas reglas que el resto del sistema.
ALTER TABLE "dentist_treatments"
  ADD CONSTRAINT "dentist_treatments_commission_range"
  CHECK ("customCommissionPercent" IS NULL
         OR ("customCommissionPercent" >= 0 AND "customCommissionPercent" <= 100));

-- --- Solicitudes de cambio de horario --------------------------------------

CREATE TABLE "schedule_change_requests" (
  "id"                TEXT NOT NULL,
  "dentistId"         TEXT NOT NULL,
  -- La semana ENTERA propuesta: [{weekday, startMinute, endMinute}, ...].
  -- JSON y no filas porque se aprueba o se rechaza entera; una aprobación
  -- parcial dejaría al odontólogo con un horario que nunca propuso.
  "proposedBlocks"    JSONB NOT NULL,
  "reason"            TEXT,
  "status"            "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT NOT NULL,
  "reviewedByUserId"  TEXT,
  "reviewedAt"        TIMESTAMPTZ(3),
  "reviewNotes"       TEXT,
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "schedule_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_change_requests_status_createdAt_idx" ON "schedule_change_requests"("status", "createdAt");
CREATE INDEX "schedule_change_requests_dentistId_status_idx" ON "schedule_change_requests"("dentistId", "status");

ALTER TABLE "schedule_change_requests"
  ADD CONSTRAINT "schedule_change_requests_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un odontólogo no puede tener dos solicitudes esperando a la vez: la segunda
-- dejaría a recepción sin saber cuál es la buena.
CREATE UNIQUE INDEX "schedule_change_requests_one_pending_per_dentist"
  ON "schedule_change_requests"("dentistId") WHERE "status" = 'PENDING';

-- --- Procedimientos añadidos a una cita ------------------------------------

-- Viene a una limpieza, el odontólogo ve una caries y la obtura en la misma
-- sesión: se agendó por una cosa y se cobra por dos.
--
-- No se edita `agreedPriceCents` porque ése es el precio congelado al agendar,
-- y la diferencia entre lo cotizado y lo cobrado es justo el dato que revela
-- si se está cotizando mal.
CREATE TABLE "appointment_addons" (
  "id"                TEXT NOT NULL,
  "appointmentId"     TEXT NOT NULL,
  "treatmentId"       TEXT NOT NULL,
  "priceCents"        INTEGER NOT NULL,
  -- Copiada al añadirlo: una radiografía añadida sigue siendo 100 % de la
  -- clínica aunque la cita principal se reparta 40/60.
  "commissionPercent" INTEGER NOT NULL,
  "notes"             TEXT,
  "addedByUserId"     TEXT,
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_addons_appointmentId_idx" ON "appointment_addons"("appointmentId");

ALTER TABLE "appointment_addons"
  ADD CONSTRAINT "appointment_addons_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment_addons"
  ADD CONSTRAINT "appointment_addons_treatmentId_fkey"
  FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_addons"
  ADD CONSTRAINT "appointment_addons_amounts"
  CHECK ("priceCents" >= 0 AND "commissionPercent" >= 0 AND "commissionPercent" <= 100);
