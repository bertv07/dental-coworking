-- ===========================================================================
--  El horario se cambia POR SEMANA, no para siempre
-- ===========================================================================
--  Cómo funciona de verdad en la clínica:
--
--   · Recepción pone el horario BASE de cada odontólogo. Es el que rige
--     mientras nadie diga lo contrario, y el que usa el bot para ofrecer
--     citas.
--   · El odontólogo puede pedir un cambio PARA UNA SEMANA CONCRETA («esta
--     semana entro a las 10»). Recepción lo acepta.
--   · Pasada esa semana, se vuelve solo al horario base.
--
--  La versión anterior aplicaba el cambio SUSTITUYENDO el horario base, así
--  que un ajuste de una semana quedaba para siempre y había que acordarse de
--  deshacerlo. Que es exactamente lo que nadie hace.

-- --- La semana a la que se refiere la solicitud ----------------------------
--
-- Se guarda el LUNES de esa semana como día ('YYYY-MM-DD'), no un rango: dos
-- solicitudes de la misma semana tienen que colisionar, y con fechas de
-- inicio y fin habría que compararlas por solape en vez de por igualdad.
ALTER TABLE "schedule_change_requests"
  ADD COLUMN "weekStart" DATE NOT NULL DEFAULT CURRENT_DATE;

-- El default existía sólo para poder añadir la columna sobre filas viejas.
-- A partir de aquí toda solicitud dice explícitamente de qué semana habla.
ALTER TABLE "schedule_change_requests" ALTER COLUMN "weekStart" DROP DEFAULT;

-- La regla de "una sola pendiente" pasa a ser POR SEMANA.
--
-- Antes era una por odontólogo, y eso impedía algo legítimo: pedir un cambio
-- para esta semana y otro distinto para la que viene.
DROP INDEX IF EXISTS "schedule_change_requests_one_pending_per_dentist";

CREATE UNIQUE INDEX "schedule_change_requests_one_pending_per_week"
  ON "schedule_change_requests"("dentistId", "weekStart")
  WHERE "status" = 'PENDING';

-- --- El horario excepcional de una semana ----------------------------------
--
-- Cuando se aprueba una solicitud, sus bloques se guardan AQUÍ, no en
-- `dentist_schedules`. El horario base queda intacto.
--
-- Al consultar la agenda de una semana: si hay filas aquí para esa semana,
-- mandan ellas; si no hay ninguna, rige el base. La ausencia de filas ES la
-- respuesta, así que no hace falta ninguna marca de "esta semana es normal".
CREATE TABLE "dentist_schedule_overrides" (
  "id"        TEXT NOT NULL,
  "dentistId" TEXT NOT NULL,

  -- Lunes de la semana a la que aplica.
  "weekStart" DATE NOT NULL,

  -- 0 = domingo … 6 = sábado, igual que en el horario base.
  "weekday"     INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute"   INTEGER NOT NULL,

  -- De qué solicitud salió, para poder rastrear quién lo pidió y quién lo
  -- aceptó sin duplicar esos datos aquí.
  "requestId" TEXT,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dentist_schedule_overrides_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dentist_schedule_overrides"
  ADD CONSTRAINT "dentist_schedule_overrides_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dentist_schedule_overrides"
  ADD CONSTRAINT "dentist_schedule_overrides_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "schedule_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La consulta real siempre es "qué tiene esta persona esta semana".
CREATE INDEX "dentist_schedule_overrides_lookup_idx"
  ON "dentist_schedule_overrides"("dentistId", "weekStart");

-- Dos bloques idénticos el mismo día de la misma semana no significan nada.
CREATE UNIQUE INDEX "dentist_schedule_overrides_unique_block"
  ON "dentist_schedule_overrides"("dentistId", "weekStart", "weekday", "startMinute");

ALTER TABLE "dentist_schedule_overrides" ADD CONSTRAINT "dentist_schedule_overrides_hours"
  CHECK (
    "weekday" BETWEEN 0 AND 6
    AND "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "endMinute" > "startMinute"
  );
