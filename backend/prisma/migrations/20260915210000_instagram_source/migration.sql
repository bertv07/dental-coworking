-- Citas agendadas por la IA desde Instagram. Va aparte de WHATSAPP_AI para
-- poder contar por qué canal entra cada paciente.
-- ALTER TYPE va solo: no puede compartir transacción con nada más.
ALTER TYPE "AppointmentSource" ADD VALUE 'INSTAGRAM_AI';
