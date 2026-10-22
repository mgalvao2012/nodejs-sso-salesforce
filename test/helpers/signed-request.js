import { createHmac } from 'node:crypto';

export function signCanvasRequest(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64');
  return `${signature}.${encoded}`;
}

export function canvasPayload({
  userId = '005000000000001AAA',
  orgId = '00D000000000001EAA',
  oauthToken = 'live-oauth-token-value',
  email = 'ana@example.com',
  issuedAt,
  algorithm = 'HMACSHA256',
  instanceUrl = 'https://example.my.salesforce.com',
} = {}) {
  const payload = {
    algorithm,
    userId,
    client: { oauthToken, instanceUrl, targetOrigin: instanceUrl },
    context: {
      user: { userId, email, fullName: 'Ana' },
      organization: { organizationId: orgId },
      environment: { parameters: {} },
    },
  };
  if (issuedAt !== undefined) payload.issuedAt = issuedAt;
  return payload;
}
