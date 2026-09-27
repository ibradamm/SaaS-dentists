import {
  PAYMENT_METHODS,
  centsToInput,
  formatCents,
  type Appointment,
  type Charge,
  type PatientDetail,
  type Payment,
  type PaymentMethod,
  type Practitioner,
} from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Badge, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { formatLocalDate, formatTime, localDateOf } from '../../lib/dates';
import {
  refreshFinance,
  useAllPractitioners,
  useClinic,
  usePatientAccount,
} from '../../lib/queries';
import { usePatientAppointments } from '../patients/PatientAppointments';
import { AmountField, amountOf } from './AmountField';
import { useIdempotencyKey } from './idempotency';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATE_TONES, chargeStateLabel } from './labels';

/** « 28/09/2026 à 10:30 », dans le fuseau du cabinet. */
const at = (iso: string, timeZone: string) =>
  `${formatLocalDate(localDateOf(iso, timeZone))} à ${formatTime(iso, timeZone)}`;

/**
 * Paiements d'un patient (ADR 0009) : montants dus, encaissements (partiels ou totaux) et
 * restant dû. Rien ne se modifie ni ne s'efface : une erreur se corrige par une annulation
 * motivée, visible dans l'historique. Le serveur vérifie chaque permission.
 */
export function PatientAccount({ patient }: { patient: PatientDetail }) {
  const { data: me } = useMe();
  const clinic = useClinic();
  const account = usePatientAccount(patient.id);
  const readsAgenda = can(me, 'appointment.read');
  const appointments = usePatientAppointments(patient.id, readsAgenda);
  const practitioners = useAllPractitioners();
  const [searchParams, setSearchParams] = useSearchParams();
  // Arrivée depuis l'agenda (« Encaisser ») : formulaire ouvert sur ce rendez-vous.
  const [prefill] = useState(() => searchParams.get('encaisser'));
  const canWrite = can(me, 'payment.write') && patient.status === 'ACTIVE';
  const [formOpen, setFormOpen] = useState(prefill !== null && canWrite);
  const [notice, setNotice] = useState<string | null>(null);

  const closeForm = () => {
    setFormOpen(false);
    if (searchParams.has('encaisser')) {
      const next = new URLSearchParams(searchParams);
      next.delete('encaisser');
      setSearchParams(next, { replace: true });
    }
  };

  const timeZone = clinic.data?.timezone ?? 'UTC';
  const data = account.data;
  const ready = data && clinic.data && (!readsAgenda || !appointments.isPending);

  return (
    <section
      id="paiements"
      aria-labelledby="paiements-titre"
      className="flex scroll-mt-4 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="paiements-titre" className="text-lg font-semibold">
          Paiements
        </h2>
        {canWrite && !formOpen && (
          <Button
            variant="secondary"
            onClick={() => {
              setNotice(null);
              setFormOpen(true);
            }}
          >
            Nouvel acte à encaisser
          </Button>
        )}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {(account.isPending || clinic.isPending) && <Loading />}
      {account.isError && <Alert>{errorMessage(account.error)}</Alert>}
      {clinic.isError && <Alert>{errorMessage(clinic.error)}</Alert>}
      {data && (
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-slate-600">Montant dû</dt>
            <dd className="font-medium">{formatCents(data.dueCents, data.currency)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Payé</dt>
            <dd className="font-medium">{formatCents(data.paidCents, data.currency)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Restant dû</dt>
            <dd
              className={`text-base font-semibold ${data.remainingCents > 0 ? 'text-amber-800' : ''}`}
            >
              {formatCents(data.remainingCents, data.currency)}
            </dd>
          </div>
        </dl>
      )}
      {ready && formOpen && (
        <NewChargeForm
          patientId={patient.id}
          currency={data.currency}
          timeZone={timeZone}
          appointments={appointments.data ?? []}
          practitioners={practitioners.data ?? []}
          charges={data.charges}
          initialAppointmentId={prefill}
          onDone={(message) => {
            setNotice(message);
            closeForm();
          }}
          onCancel={closeForm}
        />
      )}
      {data?.charges.length === 0 && (
        <p className="text-sm text-slate-600">Aucun acte enregistré pour ce patient.</p>
      )}
      {data && data.charges.length > 0 && (
        <ul aria-label="Actes et paiements" className="flex flex-col gap-3">
          {data.charges.map((c) => (
            <ChargeItem
              key={c.id}
              charge={c}
              timeZone={timeZone}
              practitioner={practitioners.data?.find((p) => p.id === c.practitionerId)}
              canWrite={canWrite}
              canVoid={can(me, 'payment.void')}
              onNotice={setNotice}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChargeItem({
  charge,
  timeZone,
  practitioner,
  canWrite,
  canVoid,
  onNotice,
}: {
  charge: Charge;
  timeZone: string;
  practitioner: Practitioner | undefined;
  canWrite: boolean;
  canVoid: boolean;
  onNotice: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<'pay' | 'cancel' | null>(null);
  const cancel = useMutation({
    mutationFn: (reason: string) => api.cancelCharge(charge.id, reason),
    onSuccess: () => {
      setPanel(null);
      onNotice(`Acte « ${charge.label} » annulé.`);
    },
    onSettled: () => refreshFinance(queryClient, charge.patientId),
  });
  const open = charge.status === 'OPEN';
  const money = (cents: number) => formatCents(cents, charge.currency);
  const details = [
    `Saisi le ${at(charge.createdAt, timeZone)}`,
    charge.appointmentStartAt ? `rendez-vous du ${at(charge.appointmentStartAt, timeZone)}` : null,
    practitioner?.displayName ?? null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium ${open ? '' : 'text-slate-500 line-through'}`}>
            {charge.label}
          </p>
          <p className="text-xs text-slate-600">{details.join(' · ')}</p>
        </div>
        <Badge tone={open ? PAYMENT_STATE_TONES[charge.paymentState] : 'neutral'}>
          {chargeStateLabel(charge.status, charge.paymentState)}
        </Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-slate-600">Dû</dt>
          <dd>{money(charge.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Payé</dt>
          <dd>{money(charge.paidCents)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Restant</dt>
          <dd className="font-medium">{open ? money(charge.remainingCents) : '—'}</dd>
        </div>
      </dl>
      {charge.status === 'CANCELLED' && (
        <p className="text-sm text-slate-700">
          Annulé
          {charge.cancelledAt ? ` le ${at(charge.cancelledAt, timeZone)}` : ''}
          {charge.cancelledBy ? ` par ${charge.cancelledBy.fullName}` : ''} — motif :{' '}
          {charge.cancellationReason}
        </p>
      )}
      {charge.payments.length > 0 && (
        <ul aria-label={`Paiements : ${charge.label}`} className="flex flex-col gap-1">
          {charge.payments.map((p) => (
            <PaymentItem
              key={p.id}
              payment={p}
              timeZone={timeZone}
              canVoid={canVoid}
              onNotice={onNotice}
            />
          ))}
        </ul>
      )}
      {open && panel === null && (
        <div className="flex flex-wrap gap-2">
          {canWrite && charge.remainingCents > 0 && (
            <Button
              aria-label={`Encaisser : ${charge.label}`}
              onClick={() => {
                onNotice(null);
                setPanel('pay');
              }}
            >
              Encaisser
            </Button>
          )}
          {canVoid && charge.paidCents === 0 && (
            <Button
              variant="danger"
              aria-label={`Annuler l’acte : ${charge.label}`}
              onClick={() => setPanel('cancel')}
            >
              Annuler l’acte
            </Button>
          )}
        </div>
      )}
      {panel === 'pay' && (
        <RecordPaymentForm
          charge={charge}
          onDone={(message) => {
            setPanel(null);
            onNotice(message);
          }}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === 'cancel' && (
        <ReasonForm
          legend={`Annuler l’acte « ${charge.label} » (${money(charge.amountCents)}) ?`}
          confirmLabel="Confirmer l’annulation de l’acte"
          pending={cancel.isPending}
          error={cancel.error}
          onConfirm={(reason) => cancel.mutate(reason)}
          onBack={() => setPanel(null)}
        />
      )}
    </li>
  );
}

function PaymentItem({
  payment,
  timeZone,
  canVoid,
  onNotice,
}: {
  payment: Payment;
  timeZone: string;
  canVoid: boolean;
  onNotice: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const amount = formatCents(payment.amountCents, payment.currency);
  const voidPayment = useMutation({
    mutationFn: (reason: string) => api.voidPayment(payment.id, reason),
    onSuccess: () => {
      setVoiding(false);
      onNotice(`Paiement de ${amount} annulé.`);
    },
    onSettled: () => refreshFinance(queryClient, payment.patientId),
  });
  const voided = payment.status === 'VOIDED';

  return (
    <li className="flex flex-col gap-1 rounded bg-slate-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-medium ${voided ? 'text-slate-500 line-through' : ''}`}>
          {amount}
        </span>
        <span>{PAYMENT_METHOD_LABELS[payment.method]}</span>
        {payment.reference && <span className="text-slate-600">réf. {payment.reference}</span>}
        <span className="text-slate-600">
          {at(payment.receivedAt, timeZone)}
          {payment.recordedBy ? ` · ${payment.recordedBy.fullName}` : ''}
        </span>
        {voided && <Badge>Paiement annulé</Badge>}
        {!voided && canVoid && !voiding && (
          <Button
            variant="danger"
            className="ml-auto"
            aria-label={`Annuler le paiement de ${amount}`}
            onClick={() => {
              onNotice(null);
              setVoiding(true);
            }}
          >
            Annuler
          </Button>
        )}
      </div>
      {voided && (
        <p className="text-slate-700">
          Annulé
          {payment.voidedAt ? ` le ${at(payment.voidedAt, timeZone)}` : ''}
          {payment.voidedBy ? ` par ${payment.voidedBy.fullName}` : ''} — motif :{' '}
          {payment.voidReason}
        </p>
      )}
      {voiding && (
        <ReasonForm
          legend={`Annuler le paiement de ${amount} ? Il restera visible, barré, dans l’historique.`}
          confirmLabel="Confirmer l’annulation du paiement"
          pending={voidPayment.isPending}
          error={voidPayment.error}
          onConfirm={(reason) => voidPayment.mutate(reason)}
          onBack={() => setVoiding(false)}
        />
      )}
    </li>
  );
}

/** Motif obligatoire d'une annulation (conservé dans l'historique, jamais dans l'audit). */
function ReasonForm({
  legend,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onBack,
}: {
  legend: string;
  confirmLabel: string;
  pending: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !pending) onConfirm(reason.trim());
      }}
    >
      <p className="text-sm font-medium text-red-900">{legend}</p>
      {error !== null && <Alert>{errorMessage(error)}</Alert>}
      <TextField
        label="Motif (obligatoire)"
        hint="Conservé dans l’historique. 3 caractères au moins."
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending || !valid}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
      </div>
    </form>
  );
}

function MethodField({
  value,
  onChange,
}: {
  value: PaymentMethod | '';
  onChange: (value: PaymentMethod | '') => void;
}) {
  // Aucun moyen par défaut : un moyen erroné fausserait les revenus sans que personne le voie.
  return (
    <SelectField
      label="Moyen de paiement"
      value={value}
      onChange={(e) => onChange(e.target.value as PaymentMethod | '')}
    >
      <option value="">Choisir…</option>
      {PAYMENT_METHODS.map((m) => (
        <option key={m} value={m}>
          {PAYMENT_METHOD_LABELS[m]}
        </option>
      ))}
    </SelectField>
  );
}

function RecordPaymentForm({
  charge,
  onDone,
  onCancel,
}: {
  charge: Charge;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const [amount, setAmount] = useState(centsToInput(charge.remainingCents));
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const cents = amountOf(amount);
  const tooMuch = cents !== null && cents > charge.remainingCents;
  const record = useMutation({
    mutationFn: (body: { amountCents: number; method: PaymentMethod }) =>
      api.recordPayment({
        idempotencyKey: idempotency.key,
        chargeId: charge.id,
        ...body,
        reference: reference.trim() || null,
      }),
    onSuccess: ({ payment, charge: updated }) => {
      idempotency.renew();
      onDone(
        `Paiement de ${formatCents(payment.amountCents, payment.currency)} encaissé. Restant dû sur l’acte : ${formatCents(updated.remainingCents, updated.currency)}.`,
      );
    },
    onError: idempotency.afterError,
    onSettled: () => refreshFinance(queryClient, charge.patientId),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (cents === null || tooMuch || method === '' || record.isPending) return;
    record.mutate({ amountCents: cents, method });
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 p-3"
      onSubmit={submit}
      noValidate
      aria-label={`Encaisser : ${charge.label}`}
    >
      <p className="text-sm">
        Restant dû : <strong>{formatCents(charge.remainingCents, charge.currency)}</strong>. Un
        paiement partiel est possible.
      </p>
      {record.isError && <Alert>{errorMessage(record.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <AmountField
          label="Montant encaissé"
          currency={charge.currency}
          value={amount}
          onChange={setAmount}
        />
        <MethodField value={method} onChange={setMethod} />
        <TextField
          label="Référence (facultatif)"
          hint="N° de chèque, de transaction…"
          maxLength={60}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      {tooMuch && (
        <Alert tone="warning">
          Le montant dépasse le restant dû ({formatCents(charge.remainingCents, charge.currency)}).
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={record.isPending || cents === null || tooMuch || method === ''}
        >
          {cents !== null && !tooMuch
            ? `Encaisser ${formatCents(cents, charge.currency)}`
            : 'Encaisser'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Fermer
        </Button>
      </div>
    </form>
  );
}

function appointmentLabel(
  a: Appointment,
  timeZone: string,
  practitioners: readonly Practitioner[],
) {
  const practitioner = practitioners.find((p) => p.id === a.practitionerId);
  return [at(a.startAt, timeZone), a.appointmentType.name, practitioner?.displayName ?? null]
    .filter(Boolean)
    .join(' · ');
}

function NewChargeForm({
  patientId,
  currency,
  timeZone,
  appointments,
  practitioners,
  charges,
  initialAppointmentId,
  onDone,
  onCancel,
}: {
  patientId: string;
  currency: string;
  timeZone: string;
  appointments: readonly Appointment[];
  practitioners: readonly Practitioner[];
  charges: readonly Charge[];
  initialAppointmentId: string | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  // Rendez-vous proposés : tous sauf les annulés, du plus récent au plus ancien.
  const options = appointments.filter((a) => a.status !== 'CANCELLED');
  const initial = options.find((a) => a.id === initialAppointmentId);
  const [appointmentId, setAppointmentId] = useState(initial?.id ?? '');
  const [practitionerId, setPractitionerId] = useState('');
  const [label, setLabel] = useState(initial?.appointmentType.name ?? '');
  const [amount, setAmount] = useState('');
  const [payNow, setPayNow] = useState(true);
  // Montant encaissé : celui de l'acte tant qu'il n'a pas été modifié à la main.
  const [paid, setPaid] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');

  const due = amountOf(amount);
  const paidInput = paid ?? amount;
  const paidCents = amountOf(paidInput);
  const tooMuch = due !== null && paidCents !== null && paidCents > due;
  const valid =
    label.trim() !== '' &&
    due !== null &&
    (!payNow || (paidCents !== null && !tooMuch && method !== ''));
  // Un acte déjà ouvert pour ce rendez-vous : un paiement complémentaire s'y ajoute plutôt
  // qu'un second acte (double facturation).
  const existing = appointmentId
    ? charges.filter((c) => c.appointmentId === appointmentId && c.status === 'OPEN')
    : [];

  const create = useMutation({
    mutationFn: () =>
      api.createCharge({
        idempotencyKey: idempotency.key,
        patientId,
        appointmentId: appointmentId || null,
        practitionerId: appointmentId ? null : practitionerId || null,
        label: label.trim(),
        amountCents: due!,
        payment:
          payNow && method !== ''
            ? { amountCents: paidCents!, method, reference: reference.trim() || null }
            : null,
      }),
    onSuccess: (charge) => {
      idempotency.renew();
      const money = (cents: number) => formatCents(cents, charge.currency);
      onDone(
        charge.paidCents > 0
          ? `Acte « ${charge.label} » enregistré, ${money(charge.paidCents)} encaissé. Restant dû : ${money(charge.remainingCents)}.`
          : `Acte « ${charge.label} » enregistré. Restant dû : ${money(charge.remainingCents)}.`,
      );
    },
    onError: idempotency.afterError,
    onSettled: () => refreshFinance(queryClient, patientId),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate();
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 p-3"
      onSubmit={submit}
      noValidate
      aria-label="Nouvel acte à encaisser"
    >
      <h3 className="font-semibold">Nouvel acte à encaisser</h3>
      {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {options.length > 0 && (
          <div className="sm:col-span-2">
            <SelectField
              label="Rendez-vous (facultatif)"
              value={appointmentId}
              onChange={(e) => {
                const next = options.find((a) => a.id === e.target.value);
                setAppointmentId(e.target.value);
                if (next && label.trim() === '') setLabel(next.appointmentType.name);
              }}
            >
              <option value="">Aucun</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {appointmentLabel(a, timeZone, practitioners)}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        {existing.length > 0 && (
          <div className="sm:col-span-2">
            <Alert tone="warning">
              Ce rendez-vous a déjà un acte ouvert :{' '}
              {existing
                .map((c) => `« ${c.label} », restant ${formatCents(c.remainingCents, c.currency)}`)
                .join(' ; ')}
              . Pour un paiement complémentaire, utilisez « Encaisser » sur cet acte.
            </Alert>
          </div>
        )}
        <TextField
          label="Libellé"
          placeholder="Consultation, détartrage…"
          maxLength={120}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <AmountField
          label="Montant dû"
          currency={currency}
          value={amount}
          onChange={setAmount}
          autoFocus={initial !== undefined}
        />
        {!appointmentId && (
          <SelectField
            label="Praticien (facultatif)"
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
          >
            <option value="">Non précisé</option>
            {practitioners
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </SelectField>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-5"
          checked={payNow}
          onChange={(e) => setPayNow(e.target.checked)}
        />
        Encaisser maintenant (paiement partiel possible)
      </label>
      {payNow && (
        <div className="grid gap-3 sm:grid-cols-3">
          <AmountField
            label="Montant encaissé"
            currency={currency}
            value={paidInput}
            onChange={setPaid}
          />
          <MethodField value={method} onChange={setMethod} />
          <TextField
            label="Référence (facultatif)"
            hint="N° de chèque, de transaction…"
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      )}
      {tooMuch && <Alert tone="warning">Le montant encaissé dépasse le montant dû.</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!valid || create.isPending}>
          {payNow && paidCents !== null && !tooMuch
            ? `Enregistrer et encaisser ${formatCents(paidCents, currency)}`
            : 'Enregistrer l’acte'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Annuler la saisie
        </Button>
      </div>
    </form>
  );
}
