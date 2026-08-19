-- ===========================================================================
--  Inventario de instrumental por odontólogo
-- ===========================================================================
--  «Cada odontólogo tenga su inventario» — y son SUS INSTRUMENTOS: el fórceps,
--  la turbina, la cureta que trajo él y que se lleva si se va.
--
--  Por eso NO es un almacén de insumos que se descuenta al usarlos. Aquí no
--  hay consumo: hay una lista de bienes con dueño, y lo que se consulta es
--  «¿qué tiene esta persona y en qué estado está?».
--
--  Un coworking lo necesita justo por eso: el instrumental es de cada quien
--  pero convive en salas compartidas, y cuando algo se pierde o aparece roto
--  hay que saber de quién era.

CREATE TYPE "InstrumentCondition" AS ENUM ('GOOD', 'NEEDS_SERVICE', 'OUT_OF_SERVICE', 'LOST');

CREATE TABLE "dentist_instruments" (
  "id"          TEXT NOT NULL,
  "dentistId"   TEXT NOT NULL,

  "name"        TEXT NOT NULL,
  -- Categoría libre ("ROTATORIO", "CIRUGÍA", "ORTODONCIA"): agrupa la lista
  -- para que 60 piezas se puedan recorrer. Libre y no un enum porque el
  -- instrumental de un cirujano y el de un ortodoncista no se parecen en nada
  -- y no hay una taxonomía que sirva a los dos.
  "category"    TEXT,

  "quantity"    INTEGER NOT NULL DEFAULT 1,

  -- Número de serie o marcado propio. Es lo que permite decir «esta turbina es
  -- la mía» cuando hay tres iguales en la clínica.
  "serialNumber" TEXT,

  "condition"   "InstrumentCondition" NOT NULL DEFAULT 'GOOD',

  -- Dónde suele estar. Texto y no FK a `rooms`: mucho instrumental vive en un
  -- maletín que va y viene, y forzar un consultorio obligaría a mentir.
  "location"    TEXT,

  "notes"       TEXT,

  -- Última revisión/mantenimiento. La turbina se manda a servicio cada tantos
  -- meses y sin esta fecha nadie recuerda cuándo fue.
  "lastServicedOn" TIMESTAMPTZ(3),

  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"   TIMESTAMPTZ(3),

  CONSTRAINT "dentist_instruments_pkey" PRIMARY KEY ("id")
);

-- CASCADE: el inventario no tiene sentido sin su dueño. A diferencia de la
-- historia clínica, esto no es un registro que deba sobrevivirle.
ALTER TABLE "dentist_instruments"
  ADD CONSTRAINT "dentist_instruments_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "dentist_instruments_dentistId_idx"
  ON "dentist_instruments"("dentistId") WHERE "deletedAt" IS NULL;

-- No se puede tener -1 fórceps.
ALTER TABLE "dentist_instruments"
  ADD CONSTRAINT "dentist_instruments_quantity_positive" CHECK ("quantity" >= 0);
