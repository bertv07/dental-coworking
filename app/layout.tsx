import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/frontend/styles/globals.css';

/**
 * Layout raíz. Único sitio donde se declaran <html> y <body>.
 *
 * Nota: los estilos globales se importan aquí y no en cada página — Next.js
 * los deduplica y los inyecta una sola vez.
 */

export const metadata: Metadata = {
  title: {
    default: 'Dental Coworking — Panel administrativo',
    template: '%s · Dental Coworking',
  },
  description: 'Gestión clínica y automatización de WhatsApp',
  /*
   * NADA se indexa por defecto: el panel no debe aparecer en Google bajo
   * ninguna circunstancia.
   *
   * Las dos páginas públicas —la portada y la política de privacidad— lo
   * levantan explícitamente en su propio `generateMetadata`. Al revés
   * (permitir por defecto y bloquear el panel pantalla por pantalla) bastaría
   * con olvidarse de una para publicar la agenda de la clínica en Google.
   */
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // El tema del navegador (barra de estado en móvil) sigue al del sistema.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1419' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
