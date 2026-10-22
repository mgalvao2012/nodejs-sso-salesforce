import express from 'express';
import { z } from 'zod';
import { withTx } from '../db.js';
import { ConflictError, DuplicateError } from '../errors.js';
import { isUuid, fieldErrors, optionalText } from '../validation.js';
import { requireAdmin } from '../auth/require-auth.js';
import { toId18 } from '../auth/sf-id.js';
import { usersRepo } from './users.repo.js';

const sfUserIdField = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : ''),
  z.string().refine((v) => {
    if (v === '') return true;
    if (!v.startsWith('005')) return false;
    try {
      toId18(v);
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid Salesforce user Id (15 or 18 characters, starting with 005).'),
);

const baseSchema = {
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.email('Invalid email.')),
  name: z.string().trim().min(1, 'Enter the name.').max(200, 'Maximum 200 characters.'),
  role: z.enum(['admin', 'user'], { message: 'Invalid role.' }),
  active: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  sfUserId: sfUserIdField,
};

const createSchema = z.object({
  ...baseSchema,
  password: z.string({ message: 'Enter the password.' }).min(12, 'Minimum 12 characters.'),
});

const updateSchema = z.object({
  ...baseSchema,
  password: z.preprocess(optionalText, z.string().min(12, 'Minimum 12 characters.').optional()),
});

const DUPLICATE_MESSAGES = {
  email: { email: 'Email already registered.' },
  sf_user_id: { sfUserId: 'Salesforce User Id is already linked to another user.' },
};

const formValues = (source) => ({
  email: source.email ?? '',
  name: source.name ?? '',
  role: source.role ?? 'user',
  active: source.active === true || source.active === 'on',
  sfUserId: source.sfUserId ?? '',
});

const AUDITED_FIELDS = ['email', 'name', 'role', 'active', 'sfUserId'];

// Must run inside a transaction: locks every active admin row so concurrent demotions serialise.
async function assertAdminInvariants(client, actor, target, next) {
  const removesAdmin = target.role === 'admin' && target.active && (!next || next.role !== 'admin' || !next.active);
  if (target.id === actor.id && (!next || removesAdmin)) {
    throw new ConflictError('You cannot deactivate, demote or delete your own user.');
  }
  if (!removesAdmin) return;
  const { rows } = await client.query(`SELECT id FROM users WHERE role = 'admin' AND active FOR UPDATE`);
  const stillAdmin = rows.some((r) => r.id === target.id);
  if (stillAdmin && rows.length <= 1) {
    throw new ConflictError('The last active administrator cannot be removed.');
  }
}

export function usersRouter({ pool }) {
  const router = express.Router();
  const users = usersRepo(pool);

  router.use('/users', requireAdmin);

  const renderForm = (res, { status = 200, target, values, errors = {} }) =>
    res.status(status).render('users/form', {
      title: target ? 'Edit user' : 'New user',
      target,
      values,
      errors,
    });

  async function loadTarget(req, res, next) {
    const target = isUuid(req.params.id) ? await users.findById(req.params.id) : null;
    if (!target) return res.status(404).render('error', { status: 404, message: 'User not found.' });
    req.target = target;
    return next();
  }

  function handleSaveError(err, res, target, body) {
    if (err instanceof DuplicateError && DUPLICATE_MESSAGES[err.field]) {
      return renderForm(res, { status: 409, target, values: formValues(body), errors: DUPLICATE_MESSAGES[err.field] });
    }
    if (err instanceof ConflictError) {
      return renderForm(res, { status: 409, target, values: formValues(body), errors: { _form: err.message } });
    }
    throw err;
  }

  router.get('/users', async (_req, res) => {
    res.render('users/index', { title: 'Users', users: await users.list({ limit: 100 }) });
  });

  router.get('/users/new', (_req, res) => renderForm(res, { values: formValues({ active: true }) }));

  router.post('/users', async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return renderForm(res, { status: 422, values: formValues(req.body), errors: fieldErrors(parsed.error) });
    }
    try {
      const created = await users.create(parsed.data);
      req.log.info({ targetUserId: created.id, changes: [...AUDITED_FIELDS, 'password'] }, 'users.created');
      if (created.sfUserId) req.log.info({ targetUserId: created.id, from: null, to: created.sfUserId }, 'users.sf_link_changed');
      return res.redirect(302, '/users');
    } catch (err) {
      return handleSaveError(err, res, null, req.body);
    }
  });

  router.get('/users/:id/edit', loadTarget, (req, res) =>
    renderForm(res, { target: req.target, values: formValues(req.target) }));

  router.put('/users/:id', loadTarget, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return renderForm(res, { status: 422, target: req.target, values: formValues(req.body), errors: fieldErrors(parsed.error) });
    }
    const data = parsed.data;
    try {
      const updated = await withTx(pool, async (client) => {
        await assertAdminInvariants(client, req.user, req.target, data);
        return usersRepo(client).update(req.target.id, data);
      });
      const changes = AUDITED_FIELDS.filter((f) => String(updated[f] ?? '') !== String(req.target[f] ?? ''));
      if (data.password) changes.push('password');
      req.log.info({ targetUserId: updated.id, changes }, 'users.updated');
      if (updated.sfUserId !== req.target.sfUserId) {
        req.log.info({ targetUserId: updated.id, from: req.target.sfUserId, to: updated.sfUserId }, 'users.sf_link_changed');
      }
      return res.redirect(302, '/users');
    } catch (err) {
      return handleSaveError(err, res, req.target, req.body);
    }
  });

  router.delete('/users/:id', loadTarget, async (req, res) => {
    try {
      await withTx(pool, async (client) => {
        await assertAdminInvariants(client, req.user, req.target, null);
        await usersRepo(client).remove(req.target.id);
      });
    } catch (err) {
      if (err instanceof ConflictError) return res.status(409).render('error', { status: 409, message: err.message });
      throw err;
    }
    req.log.info({ targetUserId: req.target.id, changes: [] }, 'users.deleted');
    return res.redirect(302, '/users');
  });

  router.post('/users/:id/unlock', loadTarget, async (req, res) => {
    await users.unlock(req.target.id);
    req.log.info({ targetUserId: req.target.id }, 'users.unlocked');
    res.redirect(302, `/users/${req.target.id}/edit`);
  });

  return router;
}
