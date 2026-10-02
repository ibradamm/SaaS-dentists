import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AuditAction } from '@dental/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import type { UserActor } from '../../auth/auth.types';
import { createPatientsService } from '../../patients/patients.service';
import { createAuditLogService } from '../audit-log.service';

/**
 * Journal d'audit consultable (docs/adr/0011) : filtres, jours locaux du cabinet, pagination
 * exacte, libellés selon les permissions, isolation entre cabinets.
 */
describe("journal d'audit : consultation", () => {
  const t = openTestDatabase();
  const service = createAuditLogService({ db: t.appDb });
  const patients = createPatientsService({
    db: t.appDb,
    secretBox: createSecretBox(randomBytes(32)),
  });
  let clinic: Clinic;
  let other: Clinic;
  let admin: UserActor;
  let secretary: UserActor;
  let dentist: UserActor;
  let otherAdmin: UserActor;

  /** Entrée écrite à un instant choisi (rôle propriétaire, dans le contexte du cabinet). */
  async function entry(
    c: Clinic,
    at: string,
    action: AuditAction,
    extra: Partial<typeof auditLogs.$inferInsert> = {},
  ) {
    const [row] = await withTenant(t.ownerDb, c.id, (tx) =>
      tx
        .insert(auditLogs)
        .values({ clinicId: c.id, actorType: 'USER', action, createdAt: new Date(at), ...extra })
        .returning({ id: auditLogs.id }),
    );
    return row!.id;
  }
  const ids = (r: { entries: { id: string }[] }) => r.entries.map((e) => e.id);

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    other = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    admin = actorFor((await createUser(t.ownerDb, clinic.id, 'ADMIN')).id, 'ADMIN', clinic.id);
    secretary = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'SECRETARY')).id,
      'SECRETARY',
      clinic.id,
    );
    dentist = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'DENTIST')).id,
      'DENTIST',
      clinic.id,
    );
    otherAdmin = actorFor((await createUser(t.ownerDb, other.id, 'ADMIN')).id, 'ADMIN', other.id);
  });
  afterAll(() => t.close());

  it('réservé à audit.read : dentiste et secrétaire refusés', async () => {
    const q = { from: '2026-09-01', to: '2026-09-30' };
    for (const actor of [dentist, secretary]) {
      await expect(service.list(actor, q)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.actors(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('période en jours locaux du cabinet (minuit à Paris, pas en UTC)', async () => {
    // 1er octobre 00 h 30 à Paris = 30 septembre 22 h 30 UTC.
    const late = await entry(clinic, '2026-09-30T22:30:00Z', 'clinic.settings_update');
    const before = await entry(clinic, '2026-09-30T21:59:59Z', 'clinic.settings_update');
    const october = await service.list(admin, { from: '2026-10-01', to: '2026-10-01' });
    expect(ids(october)).toContain(late);
    expect(ids(october)).not.toContain(before);
    const september = await service.list(admin, { from: '2026-09-30', to: '2026-09-30' });
    expect(ids(september)).toContain(before);
    expect(ids(september)).not.toContain(late);
  });

  it('filtres : utilisateur, action, élément ; plus récent d’abord', async () => {
    const patientId = randomUUID();
    const a = await entry(clinic, '2026-08-03T08:00:00Z', 'patient.updated', {
      actorId: secretary.userId,
      entityType: 'patient',
      entityId: patientId,
    });
    const b = await entry(clinic, '2026-08-03T09:00:00Z', 'patient.medical_notes_read', {
      actorId: dentist.userId,
      entityType: 'patient',
      entityId: patientId,
    });
    const c = await entry(clinic, '2026-08-03T10:00:00Z', 'charge.created', {
      actorId: secretary.userId,
      entityType: 'charge',
      entityId: randomUUID(),
    });
    const day = { from: '2026-08-03', to: '2026-08-03' };
    expect(ids(await service.list(admin, day))).toEqual([c, b, a]);
    expect(ids(await service.list(admin, { ...day, actorId: secretary.userId }))).toEqual([c, a]);
    expect(
      ids(await service.list(admin, { ...day, action: 'patient.medical_notes_read' })),
    ).toEqual([b]);
    expect(
      ids(await service.list(admin, { ...day, entityType: 'patient', entityId: patientId })),
    ).toEqual([b, a]);
    expect(ids(await service.list(admin, { ...day, entityType: 'charge' }))).toEqual([c]);
    const withNames = await service.list(admin, { ...day, actorId: dentist.userId });
    expect(withNames.entries[0]?.actor).toEqual({ id: dentist.userId, name: 'Test DENTIST' });
  });

  it('pagination exacte, y compris pour des entrées de même horodatage', async () => {
    const at = '2026-07-14T10:00:00.123456Z';
    const written = new Set<string>();
    for (let i = 0; i < 7; i++) written.add(await entry(clinic, at, 'schedule.updated'));
    const q = { from: '2026-07-14', to: '2026-07-14', limit: 3 };
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await service.list(admin, { ...q, ...(cursor ? { before: cursor } : {}) });
      seen.push(...ids(page));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(written);
    // Même chose filtrée sur un élément : PostgreSQL passe alors par un autre index (ou lit la
    // table) et trie lui-même ; seul le départage explicite par id garde des pages exactes.
    const element = randomUUID();
    const sameElement = new Set<string>();
    for (let i = 0; i < 7; i++) {
      sameElement.add(
        await entry(clinic, '2026-07-15T10:00:00Z', 'patient.updated', {
          entityType: 'patient',
          entityId: element,
        }),
      );
    }
    const filtered: string[] = [];
    let next: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await service.list(admin, {
        from: '2026-07-15',
        to: '2026-07-15',
        entityType: 'patient',
        entityId: element,
        limit: 2,
        ...(next ? { before: next } : {}),
      });
      filtered.push(...ids(page));
      next = page.nextCursor ?? undefined;
      if (!next) break;
    }
    expect(filtered).toHaveLength(7);
    expect(new Set(filtered)).toEqual(sameElement);
    // Curseur inconnu ou d'un autre cabinet : aucune entrée (jamais « tout depuis le début »).
    expect(ids(await service.list(admin, { ...q, before: randomUUID() }))).toEqual([]);
  });

  it('ordre total explicite : date puis identifiant, dans la requête elle-même', async () => {
    // Avec les index actuels, PostgreSQL rend déjà les ex æquo dans l'ordre des identifiants :
    // sans ce départage explicite, les pages resteraient justes par hasard, jusqu'au jour où un
    // autre plan d'exécution serait choisi. La requête envoyée est donc vérifiée.
    type Query = (this: unknown, ...args: unknown[]) => unknown;
    const client = pg.Client.prototype as unknown as { query: Query };
    const original = client.query;
    const texts: string[] = [];
    client.query = function (this: unknown, ...args: unknown[]) {
      const [first] = args;
      const text = typeof first === 'string' ? first : (first as { text?: string }).text;
      if (text) texts.push(text);
      return original.apply(this, args);
    };
    try {
      await service.list(admin, { from: '2026-07-14', to: '2026-07-14' });
    } finally {
      client.query = original;
    }
    const read = texts.find((q) => /from "audit_logs"/.test(q) && /limit/.test(q));
    expect(read).toMatch(/order by "audit_logs"."created_at" desc, "audit_logs"."id" desc limit/);
  });

  it('libellés : nom du patient et lien vers sa fiche ; auteur et élément d’un vrai parcours', async () => {
    const created = await patients.create(
      secretary,
      { lastName: 'Journal', firstName: 'Lecture', contacts: [] },
      META,
    );
    await patients.listMedicalNotes(dentist, created.id, META);
    // Horodatage réel de la base : fenêtre de trois jours autour d'aujourd'hui (UTC).
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const res = await service.list(admin, {
      from: day(-1),
      to: day(1),
      entityType: 'patient',
      entityId: created.id,
    });
    expect(
      res.entries.map((e) => ({ action: e.action, actor: e.actor?.name, entity: e.entity })),
    ).toEqual([
      {
        action: 'patient.medical_notes_read',
        actor: 'Test DENTIST',
        entity: { label: 'Journal Lecture', patientId: created.id },
      },
      {
        action: 'patient.created',
        actor: 'Test SECRETARY',
        entity: { label: 'Journal Lecture', patientId: created.id },
      },
    ]);
    expect(res.entries[0]?.ip).toBe(META.ip);
  });

  it('isolation : les entrées et les éléments d’un autre cabinet restent invisibles', async () => {
    const foreign = await entry(other, '2026-06-10T10:00:00Z', 'patient.created', {
      actorId: otherAdmin.userId,
      entityType: 'patient',
      entityId: randomUUID(),
    });
    const q = { from: '2026-06-10', to: '2026-06-10' };
    expect(ids(await service.list(admin, q))).toEqual([]);
    expect(ids(await service.list(otherAdmin, q))).toEqual([foreign]);
    // Le curseur d'une entrée de B ne donne rien à A.
    await entry(clinic, '2026-06-10T09:00:00Z', 'patient.created');
    expect(ids(await service.list(admin, { ...q, before: foreign }))).toEqual([]);
    const names = (await service.actors(admin)).actors.map((a) => a.id);
    expect(names).toContain(secretary.userId);
    expect(names).not.toContain(otherAdmin.userId);
  });

  it('requêtes invalides refusées : période inversée, plus d’un an, action inconnue', async () => {
    for (const q of [
      { from: '2026-09-30', to: '2026-09-01' },
      { from: '2025-01-01', to: '2026-09-30' },
      { from: '2026-09-01', to: '2026-09-30', action: 'patient.exported' },
      { from: '2026-09-01', to: '2026-09-30', limit: 1000 },
    ]) {
      await expect(service.list(admin, q)).rejects.toThrow();
    }
  });
});
