-- Jornada partida: la clínica atiende de mañana y de tarde, con un descanso
-- entre medias. Sin esto el bot ofrecía citas a las 12:30, cuando no hay nadie.
ALTER TABLE "clinic_settings" ADD COLUMN "breakStartMinute" INTEGER;
ALTER TABLE "clinic_settings" ADD COLUMN "breakEndMinute" INTEGER;
