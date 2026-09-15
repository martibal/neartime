'use strict';

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createEnvelopeProvider({ primary, fallback = null }) {
  if (!primary || typeof primary.getEnvelope !== 'function') throw codedError('envelope_primary_required');
  if (fallback && typeof fallback.getEnvelope !== 'function') throw codedError('envelope_fallback_invalid');

  return {
    async getEnvelope(args) {
      try {
        const envelope = await primary.getEnvelope(args);
        return { ...envelope, envelopeSource: 'primary' };
      } catch (primaryError) {
        if (!fallback) throw primaryError;
        const envelope = await fallback.getEnvelope(args);
        return {
          ...envelope,
          envelopeSource: 'fallback',
          primaryFailureCode: primaryError?.code || primaryError?.message || 'primary_failed',
        };
      }
    },
  };
}

module.exports = { createEnvelopeProvider };
