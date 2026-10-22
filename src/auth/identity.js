import { toId18 } from './sf-id.js';

// config.sfAllowedOrgId is normalised to 18 chars by loadConfig.

export class IdentityRejectedError extends Error {
  constructor(reason) {
    super(`Salesforce identity rejected: ${reason}`);
    this.name = 'IdentityRejectedError';
    this.reason = reason;
  }
}

const tryId18 = (value) => {
  try {
    return toId18(value);
  } catch {
    return null;
  }
};

// The only link between a Salesforce user and a local user is users.sf_user_id. Never creates or links users.
export async function resolveSalesforceUser(users, config, { orgId, userId }) {
  const org18 = tryId18(orgId);
  if (!org18 || org18 !== config.sfAllowedOrgId) throw new IdentityRejectedError('org_not_allowed');

  const user18 = tryId18(userId);
  const user = user18 ? await users.findBySfUserId(user18) : null;
  if (!user) throw new IdentityRejectedError('not_provisioned');

  if (!user.active || (user.lockedUntil && user.lockedUntil > new Date())) {
    throw new IdentityRejectedError('inactive');
  }
  return user;
}
