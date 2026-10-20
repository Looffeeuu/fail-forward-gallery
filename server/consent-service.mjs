import { POLICY_NAMES } from './policies.mjs';
import { StoryError } from './story-service.mjs';

// Records which version of the privacy notice and community rules each account
// agreed to, and when. Only the current version counts as agreed.
export function createConsentService({ database, policyVersions, now = () => new Date() }) {
  if (!database || !policyVersions) throw new TypeError('Consent service dependencies are required.');

  function status(accountId) {
    return Object.freeze(Object.fromEntries(POLICY_NAMES.map((policy) => [policy, Object.freeze({
      version: policyVersions[policy],
      accepted: database.hasConsent(accountId, policy, policyVersions[policy])
    })])));
  }

  return Object.freeze({
    status,

    accept({ accountId, policy, version }) {
      if (!accountId) {
        throw new StoryError('authentication-required', 401, 'Sign in to continue.');
      }
      if (!POLICY_NAMES.includes(policy)) {
        throw new StoryError('invalid-policy', 400, 'Choose a valid policy.');
      }
      if (version !== policyVersions[policy]) {
        throw new StoryError(
          'policy-version-outdated',
          409,
          'These rules have changed. Read the current version before agreeing.'
        );
      }
      database.recordConsent({ accountId, policy, version, acceptedAt: now() });
      return status(accountId);
    }
  });
}
