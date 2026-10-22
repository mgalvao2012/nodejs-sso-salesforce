export class DuplicateError extends Error {
  constructor(field) {
    super(`Duplicate value for ${field}`);
    this.name = 'DuplicateError';
    this.field = field;
  }
}

export class NotFoundError extends Error {
  constructor(what = 'Resource') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

const UNIQUE_CONSTRAINT_FIELDS = {
  users_email_key: 'email',
  users_sf_user_id_key: 'sf_user_id',
  customers_document_key: 'document',
};

export function translateDbError(err) {
  if (err?.code === '23505' && UNIQUE_CONSTRAINT_FIELDS[err.constraint]) {
    return new DuplicateError(UNIQUE_CONSTRAINT_FIELDS[err.constraint]);
  }
  return err;
}
