-- Vademécum de la clínica: lo que se receta habitualmente, para que recepción
-- marque lo que lleva el paciente e imprima la hoja de indicaciones.
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "presentation" TEXT,
    "posology" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medications_isActive_category_sortOrder_idx"
    ON "medications"("isActive", "category", "sortOrder");
