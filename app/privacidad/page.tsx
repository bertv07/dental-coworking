import Link from 'next/link';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  /privacidad — política de privacidad
 * ===========================================================================
 *  PÚBLICA y sin sesión: Facebook exige una URL abierta para aprobar la
 *  página y la integración de WhatsApp, y sus revisores la abren sin cuenta.
 *
 *  ---------------------------------------------------------------------
 *  ESTÁ ESCRITA SOBRE LO QUE EL SISTEMA HACE DE VERDAD
 *  ---------------------------------------------------------------------
 *  Cada punto se corresponde con algo que existe en el código: los campos de
 *  `patients`, los mensajes de WhatsApp que guarda el monitor, los PDF de
 *  `patient_documents`, la tasa de cambio que se consulta a DolarAPI. No es
 *  una plantilla genérica.
 *
 *  Eso importa por dos motivos: una política que promete lo que el sistema no
 *  cumple es peor que no tenerla, y si mañana se añade un tratamiento de
 *  datos nuevo, este archivo hay que tocarlo.
 *
 *  ⚠️  NO es asesoría legal. Describe la realidad técnica con honestidad, que
 *   es la parte que yo puedo garantizar. Antes de publicarla conviene que la
 *   revise quien lleve lo legal de la clínica.
 * ===========================================================================
 */

export const metadata = {
  title: 'Política de privacidad',
  description:
    'Qué datos recoge la clínica, para qué los usa y cómo ejercer tus derechos.',
  /*
   * Indexable a propósito. El layout raíz bloquea todo el panel, pero esta
   * página tiene que poder encontrarse: Facebook exige una URL pública y
   * accesible para aprobar la integración, y sus revisores la abren sin
   * cuenta.
   */
  robots: { index: true, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function PrivacidadPage() {
  const settings = await repository.getClinicSettings();
  const clinica = settings.clinicName;

  return (
    <main className="legal">
      <header className="legal__head">
        <h1 className="legal__title">Política de privacidad</h1>
        <p className="legal__meta">
          {clinica}
          {settings.taxId && ` · RIF ${settings.taxId}`}
        </p>
        <p className="legal__meta">Última actualización: 21 de agosto de 2026</p>
      </header>

      <section className="legal__section">
        <h2>Quién trata tus datos</h2>
        <p>
          Los datos que se describen aquí los trata <strong>{clinica}</strong>
          {settings.address && `, con domicilio en ${settings.address}`}. Para
          cualquier asunto relacionado con tu información puedes escribirnos
          {settings.email ? (
            <>
              {' '}
              a <a href={`mailto:${settings.email}`}>{settings.email}</a>
            </>
          ) : null}
          {settings.phone ? (
            <>
              {' '}
              o llamar al <a href={`tel:${settings.phone}`}>{settings.phone}</a>
            </>
          ) : null}
          .
        </p>
      </section>

      <section className="legal__section">
        <h2>Qué datos recogemos</h2>

        <h3>Cuando pides una cita</h3>
        <ul>
          <li>Tu nombre y tu número de teléfono.</li>
          <li>
            Tu correo electrónico, tu documento de identidad y tu fecha de
            nacimiento, si nos los das. Ninguno es obligatorio para atenderte.
          </li>
          <li>
            La fecha, la hora, el tratamiento y el odontólogo de cada cita.
          </li>
        </ul>

        <h3>Cuando nos escribes por WhatsApp</h3>
        <p>
          Guardamos <strong>el contenido de la conversación</strong> —lo que
          escribes y lo que se te responde— junto con tu número. Lo hacemos por
          dos motivos: para que quien te atienda después sepa qué se habló
          contigo, y porque una cita acordada por mensaje tiene que poder
          comprobarse.
        </p>
        <p>
          Una parte de las respuestas las genera un asistente automático. Cuando
          hace falta, una persona del equipo toma la conversación y sigue
          contigo. Si prefieres hablar con una persona desde el principio, sólo
          tienes que pedirlo.
        </p>

        <h3>Cuando te atendemos</h3>
        <ul>
          <li>
            El expediente clínico y el consentimiento informado que{' '}
            <strong>tú rellenas y firmas en papel</strong>, escaneados y
            guardados en tu ficha.
          </li>
          <li>Radiografías y otros documentos de tu tratamiento.</li>
          <li>
            Los tratamientos realizados y lo que se cobró por ellos, con su
            factura.
          </li>
        </ul>
      </section>

      <section className="legal__section">
        <h2>Para qué los usamos</h2>
        <ul>
          <li>Darte cita, confirmarla y recordártela.</li>
          <li>Atenderte y llevar tu historia clínica.</li>
          <li>Cobrar y emitir tu comprobante.</li>
          <li>Cumplir con las obligaciones contables y sanitarias que nos aplican.</li>
        </ul>
        <p>
          <strong>No vendemos ni cedemos tus datos a terceros</strong> para
          publicidad. Sólo te enviamos mensajes promocionales si nos has dado tu
          autorización expresa, y puedes retirarla cuando quieras.
        </p>
      </section>

      <section className="legal__section">
        <h2>Con quién los compartimos</h2>
        <p>
          Únicamente con los servicios que hacen falta para que la clínica
          funcione, y sólo con lo mínimo que cada uno necesita:
        </p>
        <ul>
          <li>
            <strong>WhatsApp (Meta)</strong>, que es por donde viajan los
            mensajes que intercambias con nosotros. Se rigen por su propia
            política de privacidad.
          </li>
          <li>
            <strong>Correo electrónico</strong>, para enviar credenciales de
            acceso al personal de la clínica. Los pacientes no reciben correos
            por esta vía.
          </li>
          <li>
            El <strong>servidor</strong> donde se aloja el sistema y su base de
            datos.
          </li>
        </ul>
        <p>
          El sistema consulta la tasa de cambio del día a un servicio público de
          cotizaciones. Esa consulta <strong>no lleva ningún dato tuyo</strong>:
          sólo pregunta a cuánto está el dólar.
        </p>
      </section>

      <section className="legal__section">
        <h2>Cuánto tiempo los guardamos</h2>
        <p>
          Tu historia clínica y tus facturas se conservan durante el plazo que
          exige la normativa sanitaria y contable. Las conversaciones de
          WhatsApp se guardan mientras sigas siendo paciente de la clínica.
        </p>
        <p>
          Cuando pides que borremos tus datos, hay parte que{' '}
          <strong>no podemos eliminar</strong>: los registros clínicos y
          contables que la ley nos obliga a conservar. En ese caso te decimos
          exactamente qué se borra y qué no, y por qué.
        </p>
      </section>

      <section className="legal__section">
        <h2>Cómo los protegemos</h2>
        <ul>
          <li>El acceso al sistema es con usuario y contraseña, y cada persona ve sólo la parte que necesita para su trabajo.</li>
          <li>Las contraseñas se guardan cifradas; nadie de la clínica puede leerlas.</li>
          <li>La conexión al sistema va cifrada de extremo a extremo.</li>
          <li>Cada acceso a tus documentos queda registrado.</li>
        </ul>
      </section>

      <section className="legal__section">
        <h2>Tus derechos</h2>
        <p>Puedes pedirnos en cualquier momento:</p>
        <ul>
          <li>Ver qué datos tuyos tenemos.</li>
          <li>Corregir los que estén mal.</li>
          <li>Que dejemos de enviarte mensajes promocionales.</li>
          <li>
            Que borremos tus datos, con la salvedad de lo que estemos obligados a
            conservar.
          </li>
          <li>Una copia de tu historia clínica.</li>
        </ul>
        <p>
          Para ejercerlos, escríbenos
          {settings.email ? (
            <>
              {' '}
              a <a href={`mailto:${settings.email}`}>{settings.email}</a>
            </>
          ) : null}
          {settings.phone ? (
            <>
              {' '}
              o llámanos al <a href={`tel:${settings.phone}`}>{settings.phone}</a>
            </>
          ) : null}
          . Te respondemos lo antes posible.
        </p>
      </section>

      <section className="legal__section">
        <h2>Menores de edad</h2>
        <p>
          Atendemos a menores acompañados de su padre, madre o representante
          legal, que es quien autoriza el tratamiento y quien ejerce estos
          derechos en su nombre.
        </p>
      </section>

      <section className="legal__section">
        <h2>Cambios en esta política</h2>
        <p>
          Si cambiamos la forma en que tratamos tus datos, actualizaremos esta
          página y la fecha del encabezado.
        </p>
      </section>

      <footer className="legal__foot">
        <Link href="/">Volver a la página principal</Link>
      </footer>
    </main>
  );
}
