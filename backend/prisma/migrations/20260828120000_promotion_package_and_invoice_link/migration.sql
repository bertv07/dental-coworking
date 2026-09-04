-- ===========================================================================
--  Paquetes a precio fijo + enlace de promoción con línea de factura
-- ===========================================================================
--  Dos cosas que faltaban:
--
--  1. Un tipo de promoción para "haz A + B + C por $X" — un paquete a precio
--     cerrado, distinto de "un tratamiento gratis" o "% de descuento".
--
--  2. Que aplicar una promoción deje RASTRO en la factura: qué línea nació de
--     cuál promoción, para no aplicarla dos veces y para poder reportarlo.
-- ===========================================================================

ALTER TYPE "PromotionBenefit" ADD VALUE 'PACKAGE_PRICE';
