import { translateDbError } from '../errors.js';

const COLUMNS = 'id, name, document, email, phone, created_by, created_at, updated_at';

function toCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export function customersRepo(db) {
  return {
    async list({ q, limit = 50, offset = 0 } = {}) {
      const params = [limit, offset];
      let where = '';
      if (q) {
        params.push(`%${escapeLike(q)}%`);
        where = `WHERE name ILIKE $3 ESCAPE '\\' OR email ILIKE $3 ESCAPE '\\' OR document ILIKE $3 ESCAPE '\\'`;
      }
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM customers ${where} ORDER BY name LIMIT $1 OFFSET $2`,
        params,
      );
      return rows.map(toCustomer);
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM customers WHERE id = $1`, [id]);
      return toCustomer(rows[0]);
    },

    async create({ name, document, email = null, phone = null }, userId) {
      try {
        const { rows } = await db.query(
          `INSERT INTO customers (name, document, email, phone, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
          [name, document, email, phone, userId],
        );
        return toCustomer(rows[0]);
      } catch (err) {
        throw translateDbError(err);
      }
    },

    async update(id, { name, document, email = null, phone = null }) {
      try {
        const { rows } = await db.query(
          `UPDATE customers SET name = $2, document = $3, email = $4, phone = $5, updated_at = now()
           WHERE id = $1 RETURNING ${COLUMNS}`,
          [id, name, document, email, phone],
        );
        return toCustomer(rows[0]);
      } catch (err) {
        throw translateDbError(err);
      }
    },

    async remove(id) {
      const { rowCount } = await db.query('DELETE FROM customers WHERE id = $1', [id]);
      return rowCount === 1;
    },
  };
}
