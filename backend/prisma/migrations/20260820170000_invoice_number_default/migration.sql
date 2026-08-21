-- ===========================================================================
--  El correlativo de la factura lo pone Postgres
-- ===========================================================================
--  La migración de facturas creó la secuencia y la usó para numerar el
--  histórico, pero se olvidó de dejarla como DEFAULT de la columna. Efecto:
--  el relleno funcionó —llamaba `nextval()` a mano— y en cambio cualquier
--  factura NUEVA fallaba con "null constraint violation on number".
--
--  El número lo da la base y no la aplicación a propósito: dos recepcionistas
--  cobrando a la vez no pueden sacar el mismo correlativo, y calcularlo en
--  Node con un `MAX(number) + 1` sí permitiría exactamente eso.
ALTER TABLE "invoices"
  ALTER COLUMN "number" SET DEFAULT nextval('invoice_number_seq');

-- La secuencia queda ligada a la columna: si algún día se borra la tabla, no
-- se queda una secuencia huérfana contando para nadie.
ALTER SEQUENCE "invoice_number_seq" OWNED BY "invoices"."number";
