'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Patient } from '@/backend/domain/types';
import {
  createPatientAction,
  updatePatientAction,
  deletePatientAction,
} from '@/app/actions/admin.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  useCrud,
  TextField,
  TextAreaField,
  CheckboxField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, EmptyState, Avatar, Notice } from '@/frontend/components/ui/primitives';

/**
 * Gestión de pacientes (CRUD).
 *
 * Componente de cliente: necesita estado de modal, búsqueda y envío. Los
 * DATOS llegan ya resueltos desde el Server Component padre — aquí no se
 * consulta nada, sólo se muestra y se muta.
 */

interface PatientsManagerProps {
  patients: Patient[];
  total: number;
  page: number;
  limit: number;
  search: string;
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Edad a partir de la fecha de nacimiento. Útil en contexto clínico. */
function getAge(birthDate: Date | null): string {
  if (!birthDate) return '';
  const years = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 3600 * 1000));
  return years > 0 && years < 120 ? `${years} años` : '';
}

export function PatientsManager({
  patients,
  total,
  page,
  limit,
  search,
}: PatientsManagerProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);

  const crud = useCrud<Patient>({
    create: createPatientAction,
    update: updatePatientAction,
    remove: deletePatientAction,
  });

  const editing = crud.mode.kind === 'edit' ? crud.mode.item : null;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  /**
   * La búsqueda va en la URL, no en estado local.
   *
   * Así el filtro se puede compartir por enlace, sobrevive a un refresco y
   * —lo importante— el filtrado ocurre en el SERVIDOR: no se envían al
   * navegador 5.000 pacientes para esconder 4.980 con JavaScript.
   */
  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set('q', searchInput.trim());
    router.push(`/pacientes?${params.toString()}`);
  }

  function goToPage(nextPage: number) {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    params.set('page', String(nextPage));
    router.push(`/pacientes?${params.toString()}`);
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <form onSubmit={runSearch} className="row" style={{ flex: 1, maxWidth: 420 }}>
            <input
              className="input"
              type="search"
              placeholder="Buscar por nombre, teléfono o documento…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar pacientes"
            />
            <button type="submit" className="btn btn--ghost">
              Buscar
            </button>
          </form>

          <button type="button" className="btn btn--primary" onClick={crud.openCreate}>
            + Nuevo paciente
          </button>
        </div>

        <div className="card__body card__body--flush">
          {patients.length === 0 ? (
            <EmptyState>
              {search
                ? `Sin resultados para "${search}".`
                : 'Aún no hay pacientes registrados.'}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Teléfono</th>
                    <th>Documento</th>
                    <th>Registro</th>
                    <th>Consentimiento</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {/* `AnimatePresence` permite animar también la SALIDA: al
                      eliminar, la fila se desvanece en vez de desaparecer
                      de golpe. */}
                  <AnimatePresence initial={false}>
                    {patients.map((patient, index) => (
                      <MotionRow key={patient.id} index={index}>
                        <td>
                          <div className="row">
                            <Avatar name={patient.fullName} small />
                            <div>
                              <div className="table__strong">{patient.fullName}</div>
                              <div className="text-xs subtle">
                                {getAge(patient.birthDate) || patient.email || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="mono text-xs">{patient.phoneE164}</td>
                        <td className="mono text-xs muted">{patient.documentId ?? '—'}</td>
                        <td className="text-xs muted">{formatDate(patient.createdAt)}</td>
                        <td>
                          {patient.marketingConsent ? (
                            <Badge tone="success">Autorizado</Badge>
                          ) : (
                            <Badge tone="neutral">Sin autorizar</Badge>
                          )}
                        </td>
                        <td>
                          <div className="table__actions">
                            {/*
                              El expediente es lo que más se abre de un
                              paciente: va antes que editar.

                              Apunta a `/expediente`, sin `/editar`: esa
                              pantalla se quitó cuando el expediente pasó a ser
                              un papel escaneado en vez de un formulario que
                              transcribía recepción. El enlace se quedó
                              apuntando a la ruta vieja y daba 404.

                              `Link` y no `<a>`: navega sin recargar el panel
                              entero, que es lo que hacía el enlace anterior.
                            */}
                            {/*
                              El paso siguiente de una venta en persona: entra
                              alguien, se le busca o se le da de alta, y de
                              aquí directo a agendarle. Sin este botón había
                              que ir al menú, abrir la agenda y volver a
                              buscarlo en el desplegable.
                            */}
                            <Link
                              href={`/agenda?paciente=${patient.id}`}
                              className="btn btn--primary btn--sm"
                              title={`Agendar cita a ${patient.fullName}`}
                            >
                              Agendar
                            </Link>
                            <Link
                              href={`/pacientes/${patient.id}/expediente`}
                              className="btn btn--ghost btn--sm"
                              title="Documentos del paciente"
                            >
                              Expediente
                            </Link>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => crud.openEdit(patient)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => crud.remove(patient, patient.fullName)}
                              disabled={crud.isPending}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </MotionRow>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div
            className="row row--between"
            style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--color-border)' }}
          >
            <span className="text-xs subtle">
              Página {page} de {totalPages} · {total} pacientes
            </span>
            <div className="row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                ← Anterior
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- Modal de alta / edición --- */}
      <Modal
        open={crud.mode.kind !== 'closed'}
        onClose={crud.close}
        title={editing ? 'Editar paciente' : 'Nuevo paciente'}
        subtitle={
          editing ? editing.fullName : 'El teléfono es la llave con la que llega el bot'
        }
        footer={<FormFooter onCancel={crud.close} isPending={crud.isPending} />}
      >
        {crud.formError && <Notice tone="danger">{crud.formError}</Notice>}

        <form
          id="crud-form"
          action={crud.submit}
          className="form-grid"
          // `key` fuerza a React a remontar el formulario al cambiar de
          // registro. Sin esto, los `defaultValue` conservarían los datos del
          // paciente anterior.
          key={editing?.id ?? 'new'}
        >
          <TextField
            label="Nombre completo"
            name="fullName"
            required
            defaultValue={editing?.fullName}
            error={crud.fieldName === 'fullName' ? crud.fieldError ?? undefined : undefined}
          />
          <TextField
            label="Teléfono (WhatsApp)"
            name="phoneE164"
            required
            placeholder="+573001234567"
            hint="Formato internacional E.164"
            defaultValue={editing?.phoneE164}
            error={crud.fieldName === 'phoneE164' ? crud.fieldError ?? undefined : undefined}
          />
          <TextField
            label="Correo electrónico"
            name="email"
            type="email"
            defaultValue={editing?.email ?? ''}
            error={crud.fieldName === 'email' ? crud.fieldError ?? undefined : undefined}
          />
          <TextField
            label="Documento"
            name="documentId"
            defaultValue={editing?.documentId ?? ''}
            error={crud.fieldName === 'documentId' ? crud.fieldError ?? undefined : undefined}
          />
          <TextField
            label="Fecha de nacimiento"
            name="birthDate"
            type="date"
            defaultValue={editing?.birthDate?.toISOString().slice(0, 10) ?? ''}
            error={crud.fieldName === 'birthDate' ? crud.fieldError ?? undefined : undefined}
          />
          <TextAreaField
            label="Notas clínicas"
            name="notes"
            placeholder="Alergias, antecedentes, observaciones…"
            defaultValue={editing?.notes ?? ''}
          />
          <CheckboxField
            label="Autoriza mensajería automatizada"
            name="marketingConsent"
            hint="Sin esta autorización, el bot no debe iniciar conversación (habeas data)."
            defaultChecked={editing?.marketingConsent ?? false}
          />
        </form>
      </Modal>
    </>
  );
}
