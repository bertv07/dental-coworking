-- ===========================================================================
--  Migración 0001 — Invariantes que Prisma no puede expresar
-- ===========================================================================
--  Prisma cubre tipos, relaciones e índices, pero no constraints de
--  exclusión ni CHECKs. Esas son justamente las reglas que protegen el
--  dinero y la agenda, así que van aquí, en el motor, donde ningún bug de
--  aplicación puede saltárselas.
--
--  Ejecutar DESPUÉS de `prisma migrate dev` (o pegar el contenido dentro
--  del archivo de migración generado).
-- ===========================================================================

-- `btree_gist` permite mezclar igualdad (=) sobre un texto con solapamiento
-- (&&) sobre un rango dentro del MISMO índice GiST. Sin esta extensión no se
-- puede escribir "mismo consultorio Y horarios que se cruzan".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
--  1. DOBLE RESERVA DE CONSULTORIO
-- ---------------------------------------------------------------------------
--  Impide que dos citas activas ocupen el mismo consultorio a la vez.
--
--  '[)' = intervalo semiabierto: una cita de 09:00–10:00 y otra de
--  10:00–11:00 NO se solapan. Con '[]' Postgres las rechazaría, que es
--  exactamente el bug clásico de las agendas mal modeladas.
--
--  El WHERE excluye canceladas / no-show: liberar el hueco cuando alguien
--  cancela es justamente lo que se espera.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_room_overlap
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND "deletedAt" IS NULL);

-- ---------------------------------------------------------------------------
--  2. DOBLE RESERVA DE ODONTÓLOGO
-- ---------------------------------------------------------------------------
--  Un odontólogo no puede estar en dos citas simultáneas, aunque sean en
--  consultorios distintos.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_dentist_overlap
  EXCLUDE USING gist (
    "dentistId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND "deletedAt" IS NULL);

-- ---------------------------------------------------------------------------
--  3. COHERENCIA TEMPORAL
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD CONSTRAINT appointments_valid_time_range
  CHECK ("endsAt" > "startsAt");

ALTER TABLE time_off
  ADD CONSTRAINT time_off_valid_range
  CHECK ("endsAt" > "startsAt");

ALTER TABLE dentist_schedules
  ADD CONSTRAINT dentist_schedules_valid_range
  CHECK (
    "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "endMinute" > "startMinute"
    AND "weekday" BETWEEN 0 AND 6
  );

-- ---------------------------------------------------------------------------
--  4. INTEGRIDAD DEL DINERO
-- ---------------------------------------------------------------------------
--  LA invariante contable del sistema: el reparto 40/60 debe sumar
--  EXACTAMENTE el total. Si un redondeo mal hecho pierde 1 centavo, el
--  INSERT falla en vez de descuadrar la contabilidad en silencio.
ALTER TABLE payments
  ADD CONSTRAINT payments_split_must_equal_total
  CHECK ("clinicShareCents" + "dentistShareCents" = "amountCents");

-- Nada de montos negativos: una devolución se modela con status REFUNDED,
-- no con un importe en negativo.
ALTER TABLE payments
  ADD CONSTRAINT payments_non_negative
  CHECK (
    "amountCents" >= 0
    AND "clinicShareCents" >= 0
    AND "dentistShareCents" >= 0
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_valid_commission
  CHECK ("commissionPercentApplied" BETWEEN 0 AND 100);

ALTER TABLE dentists
  ADD CONSTRAINT dentists_valid_commission
  CHECK ("clinicCommissionPercent" BETWEEN 0 AND 100);

ALTER TABLE treatments
  ADD CONSTRAINT treatments_valid_pricing
  CHECK (
    "basePriceCents" >= 0
    AND "durationMinutes" > 0
    AND "bufferMinutes" >= 0
  );

ALTER TABLE appointments
  ADD CONSTRAINT appointments_non_negative_price
  CHECK ("agreedPriceCents" >= 0);

-- ---------------------------------------------------------------------------
--  5. NORMALIZACIÓN DE TELÉFONOS (E.164)
-- ---------------------------------------------------------------------------
--  La llave natural con la que llega WhatsApp. Si se cuela un "+57 300 123"
--  con espacios, se duplica el paciente. El motor lo rechaza.
ALTER TABLE patients
  ADD CONSTRAINT patients_phone_e164_format
  CHECK ("phoneE164" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_phone_e164_format
  CHECK ("phoneE164" ~ '^\+[1-9][0-9]{7,14}$');

-- ---------------------------------------------------------------------------
--  6. AUDIT LOG DE SOLO INSERCIÓN
-- ---------------------------------------------------------------------------
--  Un log de auditoría que se puede editar no es un log de auditoría. Se
--  bloquea a nivel de motor: ni un bug ni una credencial comprometida de la
--  app pueden reescribir la historia.
--
--  Nota: el owner de la tabla y los superusuarios siguen pudiendo saltárselo.
--  Para cumplimiento estricto, replicar a almacenamiento WORM externo.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
-- `search_path` fijo: evita que un esquema malicioso en el path secuestre
-- la resolución de nombres dentro de la función.
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo inserción (intento de %)', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- ---------------------------------------------------------------------------
--  7. ÍNDICES DE APOYO
-- ---------------------------------------------------------------------------
--  Índice parcial para el dashboard: sólo pagos efectivamente cobrados.
--  Mucho más pequeño que el índice completo → agregaciones más rápidas.
CREATE INDEX payments_paid_at_idx
  ON payments ("paidAt")
  WHERE status = 'PAID';

--  Cubre "citas activas de hoy", la consulta más frecuente del panel.
CREATE INDEX appointments_active_upcoming_idx
  ON appointments ("startsAt")
  WHERE status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
--  8. INTEGRIDAD CAMBIARIA
-- ---------------------------------------------------------------------------
--  Una tasa de 0 o negativa convertiría todos los importes en basura, y el
--  error se propagaría a cada pago sin que nada lo detecte.
ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_positive
  CHECK (rate > 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_exchange_rate_positive
  CHECK ("exchangeRate" > 0 AND "amountBs" >= 0);

--  Sólo UNA tasa vigente por fuente. Sin esto, dos filas marcadas como
--  actuales harían que el importe en Bs dependiera del orden de la consulta.
CREATE UNIQUE INDEX exchange_rates_one_current_per_source
  ON exchange_rates (source)
  WHERE "isCurrent" = true;

-- ---------------------------------------------------------------------------
--  9. AJUSTES DE CLÍNICA: FILA ÚNICA
-- ---------------------------------------------------------------------------
--  El modelo usa id fijo "singleton". Este CHECK lo impone en el motor: sin
--  él, una segunda fila haría que la configuración dependiera de cuál se lea.
ALTER TABLE clinic_settings
  ADD CONSTRAINT clinic_settings_singleton
  CHECK (id = 'singleton');

ALTER TABLE clinic_settings
  ADD CONSTRAINT clinic_settings_valid_schedule
  CHECK (
    "openingMinute" >= 0
    AND "closingMinute" <= 1440
    AND "closingMinute" > "openingMinute"
    AND "slotMinutes" BETWEEN 5 AND 120
    AND "defaultCommissionPercent" BETWEEN 0 AND 100
  );
