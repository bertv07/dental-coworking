import { z } from 'zod';

/**
 * ===========================================================================
 *  Recetarios: qué es un elemento de la hoja
 * ===========================================================================
 *  Un recetario es una hoja con cosas encima. Cada «cosa» es un elemento con
 *  su posición, su tamaño y su estilo, y todos se guardan juntos en un JSON.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ ESTO SE VALIDA CON ZOD Y NO SE CONFÍA EN EL JSON
 *  ---------------------------------------------------------------------
 *  `elements` es una columna JSONB: Postgres acepta cualquier cosa que sea
 *  JSON válido. Sin este esquema, un cliente manipulado podría guardar un
 *  elemento con `w: 1e9` y dejar la pantalla de la odontóloga inservible, o
 *  meter HTML en un campo de texto. Aquí se acota TODO: tipos, rangos,
 *  longitudes y colores.
 *
 *  ---------------------------------------------------------------------
 *  LAS COORDENADAS SON PÍXELES DEL LIENZO, NO DE LA PANTALLA
 *  ---------------------------------------------------------------------
 *  El editor puede estar al 50 % de zoom y la impresión al 100 %: si se
 *  guardaran píxeles de pantalla, el recipe saldría movido en cuanto alguien
 *  editara desde un portátil más pequeño. Todo se guarda en el sistema de
 *  coordenadas de la hoja, y el zoom es sólo una transformación al pintar.
 * ===========================================================================
 */

/** Un color en hexadecimal. Nada de `rgb()` ni nombres: un solo formato. */
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
  .default('#000000');

/**
 * Coordenada o medida dentro de la hoja.
 *
 * Se permiten valores negativos en la posición porque un elemento puede
 * asomar por el borde a propósito (una línea que sangra, un logo recortado),
 * pero se acota para que nada se pueda «perder» a un millón de píxeles de
 * distancia, donde no habría forma de volver a seleccionarlo.
 */
const coordSchema = z.number().finite().min(-5000).max(10000);
const sizeSchema = z.number().finite().min(1).max(5000);

const baseSchema = {
  /** Identificador local del elemento; sólo tiene sentido dentro de la hoja. */
  id: z.string().min(1).max(40),
  x: coordSchema,
  y: coordSchema,
  w: sizeSchema,
  h: sizeSchema,
  /** Giro en grados. Una vuelta entera y para de contar. */
  rot: z.number().finite().min(-360).max(360).default(0),
  /** Bloqueado: se ve pero no se mueve. Para el recipe de fondo. */
  locked: z.boolean().default(false),
};

/** Texto. `content` es texto plano: se pinta como texto, nunca como HTML. */
export const textElementSchema = z.object({
  ...baseSchema,
  type: z.literal('text'),
  content: z.string().max(4000),
  fontSize: z.number().int().min(4).max(400).default(14),
  fontFamily: z.enum(['sans', 'serif', 'mono']).default('sans'),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: colorSchema,
  /** Interlineado como múltiplo del tamaño de letra. */
  lineHeight: z.number().min(0.8).max(3).default(1.3),
});

/**
 * Caja. Sirve de recuadro, de subrayado (alto 2) y de punto (5×5 con radio
 * al máximo): es la forma que cubre casi todo lo que se dibuja en un recipe.
 */
export const boxElementSchema = z.object({
  ...baseSchema,
  type: z.literal('box'),
  fill: z.union([colorSchema, z.literal('none')]).default('none'),
  stroke: colorSchema,
  strokeWidth: z.number().min(0).max(40).default(1),
  radius: z.number().min(0).max(2000).default(0),
});

/** Elipse y círculo. Mismo papel que la caja, con las esquinas redondas. */
export const ellipseElementSchema = z.object({
  ...baseSchema,
  type: z.literal('ellipse'),
  fill: z.union([colorSchema, z.literal('none')]).default('none'),
  stroke: colorSchema,
  strokeWidth: z.number().min(0).max(40).default(1),
});

/** Línea. Se dibuja de esquina a esquina de su propio rectángulo. */
export const lineElementSchema = z.object({
  ...baseSchema,
  type: z.literal('line'),
  stroke: colorSchema,
  strokeWidth: z.number().min(0.5).max(40).default(1),
});

/**
 * Imagen: el recipe escaneado, un logo, una firma.
 *
 * Guarda el id del asset, no los bytes. Meter la imagen en base64 dentro del
 * JSON haría que cada guardado del editor subiera y bajara megas por el cable
 * cada vez que se mueve una caja de sitio.
 */
export const imageElementSchema = z.object({
  ...baseSchema,
  type: z.literal('image'),
  assetId: z.string().min(1).max(40),
  opacity: z.number().min(0).max(1).default(1),
});

export const prescriptionElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  boxElementSchema,
  ellipseElementSchema,
  lineElementSchema,
  imageElementSchema,
]);

/**
 * La hoja entera.
 *
 * Tope de 200 elementos: un recetario con más que eso no es un recetario, es
 * un accidente, y pintarlo dejaría el editor inservible.
 */
export const prescriptionElementsSchema = z.array(prescriptionElementSchema).max(200);

export type PrescriptionElement = z.infer<typeof prescriptionElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type BoxElement = z.infer<typeof boxElementSchema>;
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;

/**
 * Tamaños de hoja habituales, en píxeles a 96 ppp.
 *
 * Media carta es el tamaño clásico del recetario; carta y A5 están porque
 * cada imprenta hace el suyo distinto.
 */
export const PAPER_SIZES = {
  MEDIA_CARTA: { label: 'Media carta vertical (5,5 × 8,5")', width: 528, height: 816 },
  CARTA: { label: 'Carta vertical (8,5 × 11")', width: 816, height: 1056 },
  A5: { label: 'A5 vertical (148 × 210 mm)', width: 559, height: 794 },
  A4: { label: 'A4 vertical (210 × 297 mm)', width: 794, height: 1123 },
  /*
   * Horizontales. Los recetarios reales suelen serlo: el de la Od. Martini
   * son dos mitades una al lado de la otra, prescripción e indicaciones, y en
   * vertical no cabrían.
   */
  A4_H: { label: 'A4 horizontal (297 × 210 mm)', width: 1123, height: 794 },
  CARTA_H: { label: 'Carta horizontal (11 × 8,5")', width: 1056, height: 816 },
  A5_H: { label: 'A5 horizontal (210 × 148 mm)', width: 794, height: 559 },
  MEDIA_CARTA_H: { label: 'Media carta horizontal (8,5 × 5,5")', width: 816, height: 528 },
} as const;

/**
 * Marcadores que se sustituyen al emitir un recipe para un paciente.
 *
 * Van en el texto tal cual: «Paciente: {{paciente}}». Así la odontóloga los
 * coloca donde quiera dentro de su propio diseño, en vez de que el sistema
 * decida por ella dónde va cada dato.
 */
export const PLACEHOLDERS: Array<{ clave: string; descripcion: string }> = [
  { clave: '{{paciente}}', descripcion: 'Nombre del paciente' },
  { clave: '{{documento}}', descripcion: 'Cédula del paciente' },
  { clave: '{{edad}}', descripcion: 'Edad del paciente' },
  { clave: '{{fecha}}', descripcion: 'Fecha de hoy' },
  { clave: '{{odontologo}}', descripcion: 'Nombre de la odontóloga' },
  { clave: '{{colegio}}', descripcion: 'Número de colegio' },
  { clave: '{{clinica}}', descripcion: 'Nombre de la clínica' },
];
