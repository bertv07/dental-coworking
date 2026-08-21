import { Badge, Card, EmptyState } from '@/frontend/components/ui/primitives';
import { Avatar } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  El equipo, como lo ve recepción
 * ===========================================================================
 *  «Odontólogos para asistente.» Recepción necesita saber QUIÉN hay y QUÉ
 *  hace cada quien: es lo que usa para agendar, para saber a quién derivar un
 *  paciente que pide un cirujano, y para localizar a alguien.
 *
 *  Lo que NO ve es el dinero: ni su comisión, ni lo que produjo, ni lo que la
 *  clínica le debe. Eso es una negociación entre la clínica y cada persona, y
 *  no hace falta para el trabajo del mostrador.
 *
 *  ⚠️  No se oculta con CSS ni con condicionales aquí: la página de recepción
 *   NO CONSULTA esas cifras. Este componente ni siquiera recibe un campo
 *   donde pudieran venir, así que no hay forma de que se filtren al HTML.
 *
 *  Tampoco es editable. Dar de alta a alguien implica fijarle la comisión, y
 *  eso vuelve a ser cosa de administración.
 * ===========================================================================
 */

/** Lo único que recepción necesita de un odontólogo. Sin un solo importe. */
export interface FichaOdontologo {
  id: string;
  fullName: string;
  licenseNumber: string;
  email: string;
  phone: string;
  specialties: string[];
  isActive: boolean;
}

export function DentistRoster({ dentists }: { dentists: FichaOdontologo[] }) {
  if (dentists.length === 0) {
    return (
      <Card>
        <EmptyState>Todavía no hay odontólogos registrados.</EmptyState>
      </Card>
    );
  }

  return (
    <Card
      title="Cuerpo odontológico"
      subtitle={`${dentists.length} en activo`}
      flush
    >
      <div className="table-wrap">
        <table className="table table--cards">
          <thead>
            <tr>
              <th>Odontólogo</th>
              <th>Especialidades</th>
              <th>Registro</th>
              <th>Contacto</th>
            </tr>
          </thead>
          <tbody>
            {dentists.map((dentist) => (
              <tr key={dentist.id}>
                <td data-label="Odontólogo">
                  <div className="row">
                    <Avatar name={dentist.fullName} small />
                    <div className="table__strong">{dentist.fullName}</div>
                  </div>
                </td>
                <td data-label="Especialidades">
                  {/*
                    Es la columna que de verdad usa recepción: cuando alguien
                    pide «un cirujano», esto es lo que se mira.
                  */}
                  <div className="row row--wrap" style={{ gap: '0.25rem' }}>
                    {dentist.specialties.map((specialty) => (
                      <Badge key={specialty} tone="accent">
                        {specialty}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="mono text-xs muted" data-label="Registro">
                  {dentist.licenseNumber}
                </td>
                <td className="text-xs" data-label="Contacto">
                  <div className="mono">{dentist.phone}</div>
                  <div className="subtle">{dentist.email}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
