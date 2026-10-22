export class SalesforceTokenRejectedError extends Error {
  constructor() {
    super('Salesforce reported the access token as inactive');
    this.name = 'SalesforceTokenRejectedError';
  }
}

export class SalesforceUnavailableError extends Error {
  // detail is safe to log: HTTP status / OAuth error code / error class, never response text.
  constructor(cause, detail = 'unknown') {
    super('Salesforce token introspection unavailable', { cause });
    this.name = 'SalesforceUnavailableError';
    this.detail = detail;
  }
}

const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

const IDENTITY_SUB = /\/id\/([a-zA-Z0-9]{15,18})\/([a-zA-Z0-9]{15,18})$/;

// Introspects the Canvas OAuth token with this app's credentials. Always called against the configured
// My Domain, never a URL taken from the Canvas payload. client_id proves the token was issued to our app.
export async function fetchSalesforceTokenInfo({
  myDomainUrl,
  accessToken,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  timeoutMs = 5000,
}) {
  if (typeof accessToken !== 'string' || accessToken === '') throw new SalesforceTokenRejectedError();

  let res;
  try {
    res = await fetchImpl(`${myDomainUrl}/services/oauth2/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: 'access_token',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SalesforceUnavailableError(err, `network ${err?.name ?? 'error'}`);
  }

  // 4xx here means our own client credentials were refused (misconfiguration), not a bad user token.
  if (!res.ok) {
    const code = await res.json().then((b) => b?.error, () => undefined).catch(() => undefined);
    const detail = `status ${res.status}${typeof code === 'string' && OAUTH_ERROR_CODE.test(code) ? ` ${code}` : ''}`;
    throw new SalesforceUnavailableError(new Error(detail), detail);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new SalesforceUnavailableError(err, 'invalid json');
  }
  if (body?.active !== true) throw new SalesforceTokenRejectedError();

  const match = typeof body.sub === 'string' ? body.sub.match(IDENTITY_SUB) : null;
  if (!match || typeof body.client_id !== 'string') {
    throw new SalesforceUnavailableError(new Error('unexpected introspection payload'), 'unexpected payload');
  }
  return { clientId: body.client_id, orgId: match[1], userId: match[2] };
}
