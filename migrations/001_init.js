export const up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      active boolean NOT NULL DEFAULT true,
      sf_user_id char(18) UNIQUE,
      failed_login_count int NOT NULL DEFAULT 0,
      locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      document text NOT NULL UNIQUE,
      email citext,
      phone text,
      created_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE canvas_nonces (
      hash char(64) PRIMARY KEY,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX canvas_nonces_expires_at_idx ON canvas_nonces (expires_at);

    CREATE TABLE session (
      sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    );
    CREATE INDEX session_expire_idx ON session (expire);

    GRANT SELECT, INSERT, UPDATE, DELETE ON users, customers, canvas_nonces, session TO app_runtime;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS session, canvas_nonces, customers, users;');
};
