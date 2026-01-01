# Test Suite Summary

## ✅ All New Tests Passing

The following test files were created and are **all passing**:

1. **conditions.test.ts** - 26 tests ✅
2. **effects.test.ts** - 25 tests ✅
3. **checks.test.ts** - 23 tests ✅
4. **rng.test.ts** - 18 tests ✅
5. **combat/combat.test.ts** - 15 tests ✅
6. **combat/movement.test.ts** - 8 tests ✅
7. **selectors.test.ts** - 7 tests ✅

**Total: 122 new tests, all passing**

## Test Configuration

- **Test Runner**: Vitest 1.6.1
- **TypeScript**: 5.9.2
- **Node Types**: @types/node 20.19.27
- **Configuration**: `vitest.config.ts`

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with UI
pnpm test:ui

# Type check
pnpm typecheck
```

## Known Issues

The existing `engine.test.ts` file has 16 failing tests. These failures are related to:
- Features that may have changed (e.g., `hasMoved`/`hasAttacked` flags that don't exist in current combat state)
- Tests that need to be updated to match current API

These are **not** related to the new test files created.

## Test Coverage

The new tests cover:
- ✅ Condition evaluation (flags, counters, logical operators)
- ✅ Effect application (all effect types)
- ✅ Check resolution (single, opposed, sequence, magic, combat)
- ✅ RNG determinism and seekability
- ✅ Combat state management
- ✅ Grid movement utilities
- ✅ Scene selection and text resolution

