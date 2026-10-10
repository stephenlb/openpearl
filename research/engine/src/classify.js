// Failure classifier: maps an error to a coarse class and a retry hint using
// code, name and message heuristics. Pure and deterministic.
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ETIME', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const RESOURCE_CODES = new Set(['ENOMEM', 'EMFILE', 'ENFILE', 'ENOSPC', 'ERR_WORKER_OUT_OF_MEMORY']);
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH',
  'ENETDOWN', 'EHOSTUNREACH', 'EBUSY', 'EAGAIN', 'EADDRINUSE', 'UND_ERR_SOCKET',
]);
const PERMANENT_CODES = new Set([
  'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EINVAL', 'ENOTFOUND',
  'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_MODULE_NOT_FOUND',
]);

const TIMEOUT_RE = /time(?:d)?[\s-]?out/i;
const RESOURCE_RE = /out of memory|heap|no space left|too many open files|resource exhausted/i;
const TRANSIENT_RE = /connection reset|connection refused|socket hang up|temporar|try again|service unavailable|rate limit|too many requests/i;
const PERMANENT_RE = /permission denied|not found|invalid|unauthori[sz]ed|forbidden|not permitted/i;

const verdicts = {
  transient: { class: 'transient', retryable: true },
  permanent: { class: 'permanent', retryable: false },
  timeout: { class: 'timeout', retryable: true },
  resource: { class: 'resource', retryable: true },
  unknown: { class: 'unknown', retryable: false },
};

function verdict(kind) {
  return { ...verdicts[kind] };
}

export function classifyError(err) {
  if (err === null || err === undefined) return verdict('unknown');
  const code = typeof err === 'object' && typeof err.code === 'string' ? err.code.toUpperCase() : '';
  const name = typeof err === 'object' && typeof err.name === 'string' ? err.name : '';
  const message = typeof err === 'string' ? err : typeof err.message === 'string' ? err.message : '';

  // Codes are the most specific signal, then names, then free-form messages.
  if (TIMEOUT_CODES.has(code)) return verdict('timeout');
  if (RESOURCE_CODES.has(code)) return verdict('resource');
  if (TRANSIENT_CODES.has(code)) return verdict('transient');
  if (PERMANENT_CODES.has(code)) return verdict('permanent');

  if (name === 'TimeoutError' || name === 'AbortError' && TIMEOUT_RE.test(message)) return verdict('timeout');
  if (name === 'SyntaxError' || name === 'TypeError' || name === 'RangeError' && !RESOURCE_RE.test(message)) {
    return verdict('permanent');
  }

  if (TIMEOUT_RE.test(message)) return verdict('timeout');
  if (RESOURCE_RE.test(message)) return verdict('resource');
  if (TRANSIENT_RE.test(message)) return verdict('transient');
  if (PERMANENT_RE.test(message)) return verdict('permanent');
  return verdict('unknown');
}
