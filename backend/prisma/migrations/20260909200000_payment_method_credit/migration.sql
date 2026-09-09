-- Nuevo método de pago: "pagado con la bonificación del paciente", no dinero
-- nuevo. ALTER TYPE va solo: no puede compartir transacción con nada más.
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';
