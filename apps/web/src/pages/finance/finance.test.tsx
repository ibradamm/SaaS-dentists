import {
  formatCents,
  paymentStateOf,
  type Charge,
  type MeResponse,
  type PatientAccount,
  type Payment,
  type Role,
} from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, appointment, clinic, patientDetail, practitioner } from '../../test/fixtures';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';
import { newIdempotencyKey } from './idempotency';
import { periodError, periodPresets } from './RevenuePage';

// Lundi 28 septembre 2026, 10 h à Paris : seule l'horloge est simulée.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Handlers = Parameters<typeof mockApi>[0];
// Texte tel que Testing Library le compare : espaces insécables ramenés à des espaces simples.
const eur = (cents: number) => formatCents(cents, 'EUR').replace(/\s/g, ' ');
// Noms accessibles : le texte exact, espaces insécables compris.
const money = (cents: number) => formatCents(cents, 'EUR');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const RDV = appointment().id;
const CHARGE_CONSULT = '01a0de00-0000-7000-8000-0000000c0001';
const CHARGE_DETARTRAGE = '01a0de00-0000-7000-8000-0000000c0002';
const CHARGE_RADIO = '01a0de00-0000-7000-8000-0000000c0003';
const PAYMENT_CARD = '01a0de00-0000-7000-8000-0000000e0001';
const author = { id: IDS.me, fullName: 'Camille Martin' };

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT_CARD,
    chargeId: CHARGE_CONSULT,
    patientId: IDS.patient,
    amountCents: 3000,
    currency: 'EUR',
    method: 'CARD',
    reference: null,
    status: 'RECORDED',
    receivedAt: '2026-09-21T08:15:00.000Z',
    recordedBy: author,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  };
}

function charge(overrides: Partial<Charge> & Pick<Charge, 'id' | 'label' | 'amountCents'>): Charge {
  const payments = overrides.payments ?? [];
  const paid = payments
    .filter((p) => p.status === 'RECORDED')
    .reduce((sum, p) => sum + p.amountCents, 0);
  return {
    patientId: IDS.patient,
    appointmentId: null,
    appointmentStartAt: null,
    practitionerId: null,
    paidCents: paid,
    remainingCents: overrides.amountCents - paid,
    paymentState: paymentStateOf(overrides.amountCents, paid),
    currency: 'EUR',
    status: 'OPEN',
    createdAt: '2026-09-21T08:10:00.000Z',
    createdBy: author,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    payments,
    ...overrides,
  };
}

// Consultation liée au rendez-vous, payée à moitié ; détartrage à payer ; radio annulée.
const consult = charge({
  id: CHARGE_CONSULT,
  label: 'Consultation',
  amountCents: 6000,
  appointmentId: RDV,
  appointmentStartAt: appointment().startAt,
  practitionerId: IDS.alpha,
  payments: [payment()],
});
const detartrage = charge({ id: CHARGE_DETARTRAGE, label: 'Détartrage', amountCents: 4500 });
const radio = charge({
  id: CHARGE_RADIO,
  label: 'Radio',
  amountCents: 2000,
  status: 'CANCELLED',
  cancelledAt: '2026-09-22T09:00:00.000Z',
  cancelledBy: author,
  cancellationReason: 'Acte non réalisé',
});

function account(charges: Charge[] = [consult, detartrage, radio]): PatientAccount {
  const open = charges.filter((c) => c.status === 'OPEN');
  const sum = (f: (c: Charge) => number) => open.reduce((s, c) => s + f(c), 0);
  return {
    currency: 'EUR',
    dueCents: sum((c) => c.amountCents),
    paidCents: sum((c) => c.paidCents),
    remainingCents: sum((c) => c.remainingCents),
    charges,
  };
}

function setup(
  role: Role,
  extra: Handlers = {},
  options: { account?: PatientAccount; archived?: boolean; session?: MeResponse } = {},
) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: options.session ?? me(role) }),
    'GET /api/clinic': () => ({ status: 200, body: clinic() }),
    'GET /api/practitioners': () => ({
      status: 200,
      body: { practitioners: [practitioner(IDS.alpha, 'Dr Alpha')] },
    }),
    [`GET /api/patients/${IDS.patient}`]: () => ({
      status: 200,
      body: patientDetail(options.archived ? { status: 'ARCHIVED' } : {}),
    }),
    [`GET /api/patients/${IDS.patient}/appointments`]: () => ({
      status: 200,
      body: { appointments: [appointment()] },
    }),
    [`GET /api/patients/${IDS.patient}/account`]: () => ({
      status: 200,
      body: options.account ?? account(),
    }),
    ...extra,
  });
}

const posts = (calls: MockCall[], url: string) =>
  calls.filter((c) => c.method === 'POST' && c.url === url);
const section = () => screen.findByRole('region', { name: 'Paiements' });

describe('fiche patient : paiements', () => {
  it('montant dû, payé et restant dû ; état de chaque acte ; historique des paiements', async () => {
    setup('SECRETARY');
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    // Totaux sur les actes ouverts : 60 + 45 dus, 30 payés, 75 restants (la radio annulée ne compte pas).
    const totals = (await within(payments).findByText('Montant dû')).closest('dl');
    expect(totals).toHaveTextContent(
      `Montant dû${eur(10500)}Payé${eur(3000)}Restant dû${eur(7500)}`,
    );
    // Résumé en tête de fiche : le même restant dû, qui mène à la section.
    expect(screen.getByRole('link', { name: money(7500) })).toHaveAttribute('href', '#paiements');

    const list = within(payments).getByRole('list', { name: 'Actes et paiements' });
    const items = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);
    expect(items).toHaveLength(3);
    ['Consultation', 'Détartrage', 'Radio'].forEach((label, i) =>
      expect(items[i]).toHaveTextContent(new RegExp(`^${label}`)),
    );
    expect(within(items[0]!).getByText('Partiellement payé')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/rendez-vous du 28\/09\/2026 à 09:00 · Dr Alpha/));
    expect(within(items[1]!).getByText('À payer')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Annulé')).toBeInTheDocument();
    expect(within(items[2]!).getByText(/motif : Acte non réalisé/)).toBeInTheDocument();
    // Paiement : montant, moyen, date et heure du cabinet, auteur.
    const history = within(items[0]!).getByRole('list', { name: 'Paiements : Consultation' });
    expect(history).toHaveTextContent('Carte bancaire');
    expect(history).toHaveTextContent('21/09/2026 à 10:15 · Camille Martin');
  });

  it('secrétaire : encaisse, mais aucune annulation proposée (réservée au dentiste)', async () => {
    setup('SECRETARY');
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    await within(payments).findByRole('button', { name: 'Encaisser : Consultation' });
    expect(within(payments).getByRole('button', { name: 'Nouvel acte à encaisser' })).toBeVisible();
    expect(within(payments).queryByRole('button', { name: /Annuler l’acte/ })).toBeNull();
    expect(within(payments).queryByRole('button', { name: /Annuler le paiement/ })).toBeNull();
  });

  it('paiement partiel : restant dû proposé, montant saisi en texte et envoyé en centimes', async () => {
    const calls = setup('SECRETARY', {
      'POST /api/payments': () => ({
        status: 201,
        body: {
          payment: payment({ id: '01a0de00-0000-7000-8000-0000000e0002', amountCents: 1050 }),
          charge: { ...consult, paidCents: 4050, remainingCents: 1950 },
        },
      }),
    });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    fireEvent.click(
      await within(payments).findByRole('button', { name: 'Encaisser : Consultation' }),
    );
    const form = within(payments).getByRole('form', { name: 'Encaisser : Consultation' });
    const amount = within(form).getByLabelText('Montant encaissé (EUR)');
    expect(amount).toHaveValue('30,00');
    // Aucun moyen de paiement par défaut : il faut le choisir.
    expect(within(form).getByRole('button', { name: `Encaisser ${money(3000)}` })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Moyen de paiement'), {
      target: { value: 'CASH' },
    });
    // Au-delà du restant dû : refusé avant l'envoi.
    fireEvent.change(amount, { target: { value: '30,01' } });
    expect(within(form).getByText(/Le montant dépasse le restant dû/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Encaisser' })).toBeDisabled();
    fireEvent.change(amount, { target: { value: '12,345' } });
    expect(within(form).getByText('Montant invalide (exemple : 45,50)')).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: '10,5' } });
    fireEvent.click(within(form).getByRole('button', { name: `Encaisser ${money(1050)}` }));

    expect(
      await within(payments).findByText(
        `Paiement de ${eur(1050)} encaissé. Restant dû sur l’acte : ${eur(1950)}.`,
      ),
    ).toBeInTheDocument();
    const sent = posts(calls, '/api/payments')[0]?.body as { idempotencyKey: string };
    expect(sent.idempotencyKey).toMatch(UUID_V4);
    expect(sent).toEqual({
      idempotencyKey: sent.idempotencyKey,
      chargeId: CHARGE_CONSULT,
      amountCents: 1050,
      method: 'CASH',
      reference: null,
    });
    // Compte relu après l'encaissement.
    await waitFor(() =>
      expect(calls.filter((c) => c.url === `/api/patients/${IDS.patient}/account`)).toHaveLength(2),
    );
  });

  it('issue incertaine (réseau, 500) : même clé à chaque essai ; nouvelle clé après succès ou refus', async () => {
    const outcomes = [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => ({
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' } },
      }),
      () => ({ status: 201, body: { payment: payment({ amountCents: 1000 }), charge: consult } }),
      () => ({
        status: 409,
        body: {
          error: { code: 'AMOUNT_EXCEEDS_REMAINING', message: 'Montant supérieur au restant dû' },
        },
      }),
      () => ({ status: 201, body: { payment: payment({ amountCents: 1000 }), charge: consult } }),
    ];
    const calls = setup('SECRETARY', {
      'POST /api/payments': () => outcomes.shift()!(),
    });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    const pay = async () => {
      if (!within(payments).queryByRole('form', { name: 'Encaisser : Consultation' })) {
        fireEvent.click(within(payments).getByRole('button', { name: 'Encaisser : Consultation' }));
        const form = within(payments).getByRole('form', { name: 'Encaisser : Consultation' });
        fireEvent.change(within(form).getByLabelText('Montant encaissé (EUR)'), {
          target: { value: '10' },
        });
        fireEvent.change(within(form).getByLabelText('Moyen de paiement'), {
          target: { value: 'CARD' },
        });
      }
      const count = posts(calls, '/api/payments').length;
      fireEvent.click(within(payments).getByRole('button', { name: `Encaisser ${money(1000)}` }));
      await waitFor(() => expect(posts(calls, '/api/payments')).toHaveLength(count + 1));
      // Envoi terminé : formulaire refermé (succès) ou bouton de nouveau actif (échec).
      await waitFor(() =>
        expect(
          within(payments)
            .queryByRole('button', { name: `Encaisser ${money(1000)}` })
            ?.hasAttribute('disabled') ?? false,
        ).toBe(false),
      );
    };
    await within(payments).findByRole('button', { name: 'Encaisser : Consultation' });
    await pay(); // réseau coupé
    expect(await within(payments).findByText(/Vérifiez votre connexion/)).toBeInTheDocument();
    await pay(); // erreur serveur
    await within(payments).findByText('Erreur interne');
    await pay(); // succès
    await within(payments).findByText(/encaissé/);
    await pay(); // refus 409
    await within(payments).findByText('Montant supérieur au restant dû');
    await pay(); // succès
    const keys = posts(calls, '/api/payments').map(
      (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(5);
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    expect(keys[3]).not.toBe(keys[2]);
    expect(keys[4]).not.toBe(keys[3]);
  });

  it('double clic sur « Encaisser » : une seule saisie, la même clé pour chaque envoi', async () => {
    const calls = setup('SECRETARY', {
      'POST /api/payments': () => ({
        status: 201,
        body: { payment: payment({ amountCents: 3000 }), charge: consult },
      }),
    });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    fireEvent.click(
      await within(payments).findByRole('button', { name: 'Encaisser : Consultation' }),
    );
    const form = within(payments).getByRole('form', { name: 'Encaisser : Consultation' });
    fireEvent.change(within(form).getByLabelText('Moyen de paiement'), {
      target: { value: 'CARD' },
    });
    const submit = within(form).getByRole('button', { name: `Encaisser ${money(3000)}` });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await within(payments).findByText(/encaissé/);
    const keys = new Set(
      posts(calls, '/api/payments').map(
        (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
      ),
    );
    expect(keys.size).toBe(1);
  });

  it('nouvel acte avec paiement partiel immédiat ; puis acte seul, sans paiement', async () => {
    const created = charge({
      id: '01a0de00-0000-7000-8000-0000000c0009',
      label: 'Couronne',
      amountCents: 45000,
      payments: [payment({ amountCents: 15050, method: 'CHECK' })],
    });
    const calls = setup('SECRETARY', {
      'POST /api/charges': () => ({ status: 201, body: created }),
    });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    fireEvent.click(
      await within(payments).findByRole('button', { name: 'Nouvel acte à encaisser' }),
    );
    let form = within(payments).getByRole('form', { name: 'Nouvel acte à encaisser' });
    fireEvent.change(within(form).getByLabelText('Libellé'), { target: { value: ' Couronne ' } });
    fireEvent.change(within(form).getByLabelText('Montant dû (EUR)'), {
      target: { value: '450' },
    });
    // Montant encaissé : celui de l'acte, tant qu'il n'est pas modifié.
    const paid = within(form).getByLabelText('Montant encaissé (EUR)');
    expect(paid).toHaveValue('450');
    fireEvent.change(paid, { target: { value: '450,01' } });
    expect(within(form).getByText('Le montant encaissé dépasse le montant dû.')).toBeVisible();
    fireEvent.change(paid, { target: { value: '150,5' } });
    fireEvent.change(within(form).getByLabelText('Moyen de paiement'), {
      target: { value: 'CHECK' },
    });
    fireEvent.change(within(form).getByLabelText('Référence (facultatif)'), {
      target: { value: '1234567' },
    });
    fireEvent.change(within(form).getByLabelText('Praticien (facultatif)'), {
      target: { value: IDS.alpha },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: `Enregistrer et encaisser ${money(15050)}` }),
    );
    expect(
      await within(payments).findByText(
        `Acte « Couronne » enregistré, ${eur(15050)} encaissé. Restant dû : ${eur(29950)}.`,
      ),
    ).toBeInTheDocument();
    const first = posts(calls, '/api/charges')[0]?.body as { idempotencyKey: string };
    expect(first.idempotencyKey).toMatch(UUID_V4);
    expect(first).toEqual({
      idempotencyKey: first.idempotencyKey,
      patientId: IDS.patient,
      appointmentId: null,
      practitionerId: IDS.alpha,
      label: 'Couronne',
      amountCents: 45000,
      payment: { amountCents: 15050, method: 'CHECK', reference: '1234567' },
    });

    fireEvent.click(within(payments).getByRole('button', { name: 'Nouvel acte à encaisser' }));
    form = within(payments).getByRole('form', { name: 'Nouvel acte à encaisser' });
    fireEvent.change(within(form).getByLabelText('Libellé'), { target: { value: 'Bilan' } });
    fireEvent.change(within(form).getByLabelText('Montant dû (EUR)'), {
      target: { value: '0,29' },
    });
    fireEvent.click(within(form).getByLabelText(/Encaisser maintenant/));
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer l’acte' }));
    await waitFor(() => expect(posts(calls, '/api/charges')).toHaveLength(2));
    const second = posts(calls, '/api/charges')[1]?.body as Record<string, unknown>;
    expect(second).toMatchObject({ amountCents: 29, payment: null, label: 'Bilan' });
    // Nouvelle saisie après un succès : nouvelle clé.
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('depuis l’agenda (?encaisser=) : formulaire ouvert sur le rendez-vous, acte existant signalé', async () => {
    setup('SECRETARY');
    renderApp(`/patients/${IDS.patient}?encaisser=${RDV}`);
    const form = await screen.findByRole('form', { name: 'Nouvel acte à encaisser' });
    expect(within(form).getByLabelText('Rendez-vous (facultatif)')).toHaveValue(RDV);
    expect(within(form).getByLabelText('Libellé')).toHaveValue('Consultation');
    expect(within(form).getByLabelText('Montant dû (EUR)')).toHaveFocus();
    // Le praticien est celui du rendez-vous : pas de choix séparé.
    expect(within(form).queryByLabelText('Praticien (facultatif)')).toBeNull();
    expect(within(form).getByRole('alert')).toHaveTextContent(
      `Ce rendez-vous a déjà un acte ouvert : « Consultation », restant ${eur(3000)}`,
    );
  });

  it('dentiste : annule un paiement et un acte non payé, motif obligatoire', async () => {
    const calls = setup('DENTIST', {
      [`POST /api/payments/${PAYMENT_CARD}/void`]: () => ({
        status: 200,
        body: {
          payment: payment({
            status: 'VOIDED',
            voidedAt: '2026-09-28T08:00:00.000Z',
            voidedBy: author,
            voidReason: 'Erreur de saisie',
          }),
          charge: consult,
        },
      }),
      [`POST /api/charges/${CHARGE_DETARTRAGE}/cancel`]: () => ({
        status: 200,
        body: { ...detartrage, status: 'CANCELLED' },
      }),
    });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    // Un acte déjà payé (même en partie) ne s'annule pas : il faut d'abord annuler ses paiements.
    await within(payments).findByRole('button', { name: 'Annuler l’acte : Détartrage' });
    expect(
      within(payments).queryByRole('button', { name: 'Annuler l’acte : Consultation' }),
    ).toBeNull();

    fireEvent.click(
      within(payments).getByRole('button', { name: `Annuler le paiement de ${money(3000)}` }),
    );
    const confirm = within(payments).getByRole('button', {
      name: 'Confirmer l’annulation du paiement',
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(payments).getByLabelText('Motif (obligatoire)'), {
      target: { value: 'ab' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(payments).getByLabelText('Motif (obligatoire)'), {
      target: { value: ' Erreur de saisie ' },
    });
    fireEvent.click(confirm);
    expect(
      await within(payments).findByText(`Paiement de ${eur(3000)} annulé.`),
    ).toBeInTheDocument();
    expect(posts(calls, `/api/payments/${PAYMENT_CARD}/void`)[0]?.body).toEqual({
      reason: 'Erreur de saisie',
    });

    fireEvent.click(within(payments).getByRole('button', { name: 'Annuler l’acte : Détartrage' }));
    fireEvent.change(within(payments).getByLabelText('Motif (obligatoire)'), {
      target: { value: 'Acte non réalisé' },
    });
    fireEvent.click(
      within(payments).getByRole('button', { name: 'Confirmer l’annulation de l’acte' }),
    );
    expect(await within(payments).findByText('Acte « Détartrage » annulé.')).toBeInTheDocument();
    expect(posts(calls, `/api/charges/${CHARGE_DETARTRAGE}/cancel`)[0]?.body).toEqual({
      reason: 'Acte non réalisé',
    });
  });

  it('paiement annulé : barré, motif et auteur visibles, plus d’action possible', async () => {
    const voided = payment({
      status: 'VOIDED',
      voidedAt: '2026-09-22T10:00:00.000Z',
      voidedBy: author,
      voidReason: 'Doublon',
    });
    setup('DENTIST', {}, { account: account([{ ...consult, payments: [voided] }]) });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    const history = await within(payments).findByRole('list', { name: 'Paiements : Consultation' });
    expect(within(history).getByText('Paiement annulé')).toBeInTheDocument();
    expect(history).toHaveTextContent('le 22/09/2026 à 12:00 par Camille Martin — motif : Doublon');
    expect(within(history).queryByRole('button')).toBeNull();
  });

  it('patient archivé : historique visible, aucune saisie proposée', async () => {
    setup('SECRETARY', {}, { archived: true });
    renderApp(`/patients/${IDS.patient}`);
    const payments = await section();
    await within(payments).findByText('Consultation');
    expect(within(payments).queryByRole('button', { name: 'Nouvel acte à encaisser' })).toBeNull();
    expect(within(payments).queryByRole('button', { name: /Encaisser/ })).toBeNull();
  });

  it('sans droit de lecture des paiements : ni section, ni appel au compte', async () => {
    const session = me('SECRETARY');
    session.permissions = session.permissions.filter((p) => !p.startsWith('payment.'));
    const calls = setup('SECRETARY', {}, { session });
    renderApp(`/patients/${IDS.patient}`);
    await screen.findByRole('heading', { name: 'Téléphones' });
    expect(screen.queryByRole('region', { name: 'Paiements' })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/account'))).toBe(false);
  });
});

describe('à encaisser', () => {
  it('patients avec un restant dû, du plus ancien au plus récent, lien vers leur compte', async () => {
    setup('SECRETARY', {
      'GET /api/receivables': () => ({
        status: 200,
        body: {
          currency: 'EUR',
          totalRemainingCents: 7500,
          patients: [
            {
              patient: { id: IDS.patient, lastName: 'Dupont', firstName: 'Léa' },
              remainingCents: 7500,
              openCharges: 2,
              oldestChargeAt: '2026-09-21T08:10:00.000Z',
            },
          ],
        },
      }),
    });
    renderApp('/encaissements');
    expect(await screen.findByRole('heading', { name: 'À encaisser' })).toBeInTheDocument();
    expect(screen.getByText(/Restant dû de tout le cabinet/)).toHaveTextContent(eur(7500));
    const list = screen.getByRole('list', { name: 'Patients avec un restant dû' });
    expect(within(list).getByRole('link', { name: 'DUPONT Léa' })).toHaveAttribute(
      'href',
      `/patients/${IDS.patient}#paiements`,
    );
    expect(list).toHaveTextContent('2 actes ouverts · depuis le 21/09/2026');
  });
});

describe('revenus encaissés', () => {
  const revenue = {
    currency: 'EUR',
    from: '2026-09-01',
    to: '2026-09-28',
    totalCents: 16000,
    paymentsCount: 3,
    voided: { amountCents: 2000, count: 1 },
    byMethod: [
      { method: 'CARD', amountCents: 10000, count: 2 },
      { method: 'CASH', amountCents: 6000, count: 1 },
    ],
    byPractitioner: [
      { practitionerId: IDS.alpha, displayName: 'Dr Alpha', amountCents: 10000, count: 2 },
      { practitionerId: null, displayName: null, amountCents: 6000, count: 1 },
    ],
    byDay: [{ date: '2026-09-28', amountCents: 16000, count: 3 }],
    remainingCents: 7500,
  };
  const journal = {
    payments: [
      {
        ...payment({ status: 'VOIDED', voidedAt: '2026-09-28T07:00:00.000Z', voidReason: 'X' }),
        patient: { id: IDS.patient, lastName: 'Dupont', firstName: 'Léa' },
        chargeLabel: 'Consultation',
        practitionerId: IDS.alpha,
      },
    ],
  };

  it('dentiste : ce mois par défaut ; totaux, répartitions, annulés à part ; changement de période', async () => {
    const calls = setup('DENTIST', {
      'GET /api/finance/revenue': () => ({ status: 200, body: revenue }),
      'GET /api/finance/payments': () => ({ status: 200, body: journal }),
    });
    renderApp('/revenus');
    expect(await screen.findByText('Encaissé du 01/09/2026 au 28/09/2026')).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toContain('/api/finance/revenue?from=2026-09-01&to=2026-09-28');
    expect(screen.getByText(/^Encaissé du/).parentElement).toHaveTextContent(
      `${eur(16000)}3 paiements`,
    );
    expect(screen.getByText('Paiements annulés (non comptés)').nextSibling).toHaveTextContent(
      eur(2000),
    );
    expect(screen.getByRole('rowheader', { name: 'Non précisé' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Carte bancaire' })).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /DUPONT Léa/ });
    expect(within(row).getByText('Annulé')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'DUPONT Léa' })).toHaveAttribute(
      'href',
      `/patients/${IDS.patient}#paiements`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aujourd’hui' }));
    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain(
        '/api/finance/revenue?from=2026-09-28&to=2026-09-28',
      ),
    );
    expect(screen.getByRole('button', { name: 'Aujourd’hui' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Période incohérente : message, aucun appel.
    const before = calls.length;
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-09-30' } });
    expect(
      await screen.findByText('La date de début doit précéder la date de fin.'),
    ).toBeInTheDocument();
    expect(calls.slice(before).some((c) => c.url.startsWith('/api/finance'))).toBe(false);
  });

  it('secrétaire : page refusée, aucun appel aux revenus', async () => {
    const calls = setup('SECRETARY');
    renderApp('/revenus');
    expect(await screen.findByText("Vous n'avez pas accès à cette page.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/finance'))).toBe(false);
  });
});

describe('règles pures', () => {
  it('périodes proposées, en dates locales', () => {
    expect(periodPresets('2026-03-15')).toEqual([
      { label: 'Aujourd’hui', from: '2026-03-15', to: '2026-03-15' },
      { label: '7 derniers jours', from: '2026-03-09', to: '2026-03-15' },
      { label: 'Ce mois-ci', from: '2026-03-01', to: '2026-03-15' },
      { label: 'Mois précédent', from: '2026-02-01', to: '2026-02-28' },
    ]);
    expect(periodPresets('2026-01-10')[3]).toEqual({
      label: 'Mois précédent',
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('période : dates complètes, ordonnées, une année au plus', () => {
    expect(periodError('2026-01-01', '2026-12-31')).toBeNull();
    expect(periodError('', '2026-12-31')).toBe('Choisissez deux dates.');
    expect(periodError('2026-02-01', '2026-01-31')).toMatch(/précéder/);
    expect(periodError('2025-01-01', '2026-01-02')).toBe('Période limitée à une année.');
  });

  it('clé d’idempotence : UUID v4, même hors contexte sécurisé', () => {
    expect(newIdempotencyKey()).toMatch(UUID_V4);
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
      expect(keys.size).toBe(50);
      for (const key of keys) expect(key).toMatch(UUID_V4);
    } finally {
      Reflect.deleteProperty(crypto, 'randomUUID');
    }
    expect(typeof crypto.randomUUID).toBe('function');
  });
});
