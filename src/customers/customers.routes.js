import express from 'express';
import { z } from 'zod';
import { DuplicateError } from '../errors.js';
import { isUuid, fieldErrors, optionalText } from '../validation.js';
import { customersRepo } from './customers.repo.js';

const PAGE_SIZE = 50;

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name.').max(200, 'Maximum 200 characters.'),
  document: z
    .string()
    .transform((v) => v.replace(/[.\-/\s]/g, ''))
    .pipe(z.string().regex(/^(\d{11}|\d{14})$/, 'CPF (11 digits) or CNPJ (14 digits).')),
  email: z.preprocess(optionalText, z.email('Invalid email.').optional()),
  phone: z.preprocess(optionalText, z.string().max(20, 'Maximum 20 characters.').optional()),
});

const formFields = (body) => ({
  name: body.name ?? '',
  document: body.document ?? '',
  email: body.email ?? '',
  phone: body.phone ?? '',
});

export function customersRouter({ pool }) {
  const router = express.Router();
  const customers = customersRepo(pool);

  const renderForm = (res, { status = 200, customer, values, errors = {} }) =>
    res.status(status).render('customers/form', {
      title: customer ? 'Edit customer' : 'New customer',
      customer,
      values,
      errors,
    });

  async function loadCustomer(req, res, next) {
    const customer = isUuid(req.params.id) ? await customers.findById(req.params.id) : null;
    if (!customer) return res.status(404).render('error', { status: 404, message: 'Customer not found.' });
    req.customer = customer;
    return next();
  }

  async function save(req, res, existing) {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) {
      return renderForm(res, { status: 422, customer: existing, values: formFields(req.body), errors: fieldErrors(parsed.error) });
    }
    try {
      const saved = existing
        ? await customers.update(existing.id, parsed.data)
        : await customers.create(parsed.data, req.user.id);
      req.log.info({ customerId: saved.id }, existing ? 'customers.updated' : 'customers.created');
      return res.redirect(302, `/customers/${saved.id}`);
    } catch (err) {
      if (err instanceof DuplicateError) {
        return renderForm(res, {
          status: 409,
          customer: existing,
          values: formFields(req.body),
          errors: { document: 'Document already registered.' },
        });
      }
      throw err;
    }
  }

  router.get('/customers', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const list = await customers.list({ q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    res.render('customers/index', { title: 'Customers', customers: list, q, page, hasNext: list.length === PAGE_SIZE });
  });

  router.get('/customers/new', (_req, res) => renderForm(res, { values: formFields({}) }));
  router.post('/customers', (req, res) => save(req, res, null));
  router.get('/customers/:id', loadCustomer, (req, res) =>
    res.render('customers/show', { title: req.customer.name, customer: req.customer }));
  router.get('/customers/:id/edit', loadCustomer, (req, res) =>
    renderForm(res, { customer: req.customer, values: formFields(req.customer) }));
  router.put('/customers/:id', loadCustomer, (req, res) => save(req, res, req.customer));
  router.delete('/customers/:id', loadCustomer, async (req, res) => {
    await customers.remove(req.customer.id);
    req.log.info({ customerId: req.customer.id }, 'customers.deleted');
    res.redirect(302, '/customers');
  });

  return router;
}
