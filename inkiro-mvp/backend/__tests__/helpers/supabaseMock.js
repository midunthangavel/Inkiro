'use strict';

/**
 * Creates a chainable Supabase query-builder mock.
 *
 * All filter/modifier methods return `this` for chaining:
 *   db.from('t').select('*').eq('id', x).single()
 *
 * The chain is also thenable — `await chain` resolves to `result`.
 * Terminal methods (.single, .maybeSingle) return a resolved Promise.
 *
 * @param {{ data: any, error: any }} result
 */
function makeChain(result = { data: null, error: null }) {
  const chain = {
    // Chainable — return `this`
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    or:          jest.fn().mockReturnThis(),
    lt:          jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    not:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    // Terminal — return a Promise
    single:      jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };

  // Make the chain itself awaitable.
  // Handles: `const { data } = await db.from('t').update({}).eq('id', x)`
  chain.then  = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain.catch = (onRejected)      => Promise.resolve(result).catch(onRejected);

  return chain;
}

/**
 * Creates a minimal mock Supabase client: `{ from: jest.fn() }`.
 * By default `from()` returns a fresh makeChain(defaultResult) each call.
 */
function makeClient(defaultResult = { data: null, error: null }) {
  return { from: jest.fn(() => makeChain(defaultResult)) };
}

module.exports = { makeChain, makeClient };
