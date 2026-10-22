import { hashPassword } from '../security/password.js';
import { toId18 } from '../auth/sf-id.js';
import { translateDbError } from '../errors.js';

const PUBLIC_COLUMNS = `id, email, name, role, active, sf_user_id, failed_login_count, locked_until, created_at, updated_at`;

function toUser(row, { withHash = false } = {}) {
  if (!row) return null;
  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    sfUserId: row.sf_user_id,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withHash) user.passwordHash = row.password_hash;
  return user;
}

const normalizeSfUserId = (value) => (value ? toId18(value) : null);

export function usersRepo(db) {
  const one = async (sql, params, opts) => toUser((await db.query(sql, params)).rows[0], opts);

  return {
    findById: (id) => one(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]),

    findByEmailWithHash: (email) =>
      one(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`, [email], { withHash: true }),

    findBySfUserId: (sfUserId) => one(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE sf_user_id = $1`, [sfUserId]),

    async list({ limit = 50, offset = 0 } = {}) {
      const { rows } = await db.query(
        `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name, email LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return rows.map((r) => toUser(r));
    },

    async create({ email, name, password, role = 'user', active = true, sfUserId = null }) {
      const passwordHash = await hashPassword(password);
      try {
        return await one(
          `INSERT INTO users (email, name, password_hash, role, active, sf_user_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_COLUMNS}`,
          [email, name, passwordHash, role, active, normalizeSfUserId(sfUserId)],
        );
      } catch (err) {
        throw translateDbError(err);
      }
    },

    async update(id, changes) {
      const sets = [];
      const params = [];
      const set = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (changes.email !== undefined) set('email', changes.email);
      if (changes.name !== undefined) set('name', changes.name);
      if (changes.role !== undefined) set('role', changes.role);
      if (changes.active !== undefined) set('active', changes.active);
      if (changes.sfUserId !== undefined) set('sf_user_id', normalizeSfUserId(changes.sfUserId));
      if (changes.password) set('password_hash', await hashPassword(changes.password));
      if (sets.length === 0) return this.findById(id);
      params.push(id);
      try {
        return await one(
          `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING ${PUBLIC_COLUMNS}`,
          params,
        );
      } catch (err) {
        throw translateDbError(err);
      }
    },

    async remove(id) {
      const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
      return rowCount === 1;
    },

    async countActiveAdmins() {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active`);
      return rows[0].n;
    },

    async recordLoginFailure(id) {
      const { rows } = await db.query(
        `UPDATE users SET
           failed_login_count = CASE WHEN failed_login_count + 1 >= 5 THEN 0 ELSE failed_login_count + 1 END,
           locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
         WHERE id = $1
         RETURNING failed_login_count, locked_until`,
        [id],
      );
      const row = rows[0];
      return { lockedUntil: row && row.failed_login_count === 0 ? row.locked_until : null };
    },

    async resetLoginFailures(id) {
      await db.query('UPDATE users SET failed_login_count = 0 WHERE id = $1 AND failed_login_count <> 0', [id]);
    },

    async unlock(id) {
      await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [id]);
    },
  };
}
