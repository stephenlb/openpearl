// Fault injector: wraps a function so calls randomly fail with a typed error
// and/or are delayed. RNG and sleep are injectable so tests stay deterministic.
export class ChaosError extends Error {
  constructor(message = 'Injected fault') {
    super(message);
    this.name = 'ChaosError';
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createChaos({
  rng = Math.random,
  failRate = 0,
  latencyMs = 0,
  errorTypes = [ChaosError],
  sleep = realSleep,
} = {}) {
  if (!(failRate >= 0 && failRate <= 1)) throw new RangeError('failRate must be between 0 and 1');
  if (!(latencyMs >= 0)) throw new RangeError('latencyMs must be >= 0');
  if (!Array.isArray(errorTypes) || errorTypes.length === 0) {
    throw new TypeError('errorTypes must be a non-empty array');
  }

  function wrap(fn) {
    return async function chaotic(...args) {
      if (latencyMs > 0) await sleep(latencyMs);
      if (rng() < failRate) {
        const Type = errorTypes[Math.floor(rng() * errorTypes.length)];
        throw new Type('Injected fault');
      }
      return fn.apply(this, args);
    };
  }

  return { wrap };
}
