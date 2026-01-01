# Testing Guide

## Test Coverage

The engine package includes comprehensive unit tests for all core modules:

### ✅ Passing Test Suites

- **conditions.test.ts** (26 tests) - Condition evaluation system
- **effects.test.ts** (25 tests) - Effect application system
- **checks.test.ts** (23 tests) - Check resolution system
- **rng.test.ts** (18 tests) - Random number generation
- **combat/combat.test.ts** (15 tests) - Combat state management
- **combat/movement.test.ts** (8 tests) - Grid movement utilities
- **selectors.test.ts** (7 tests) - State selection utilities

**Total: 122 new tests, all passing**

### Test Helpers

Located in `src/runtime/test-helpers/`:

- **FakeRng** - Deterministic RNG for testing
- **makeTestActor()** - Create test actors with defaults
- **makeTestStoryPack()** - Create test story packs
- **makeTestSave()** - Create test game saves

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run specific test file
pnpm test conditions.test.ts
```

## Test Patterns

### 1. Deterministic Testing

All tests use fixed seeds and deterministic RNG:

```typescript
const rng = new FakeRng([30, 50, 70]); // Fixed rolls
```

### 2. Immutability Testing

Tests verify that functions don't mutate input:

```typescript
const originalSave = makeTestSave(storyPack, actor);
const updatedSave = applyEffect(effect, storyPack, originalSave, rng);

// Original should be unchanged
expect(originalSave.state.flags).not.toHaveProperty("newFlag");
expect(updatedSave.state.flags).toHaveProperty("newFlag");
```

### 3. Edge Case Coverage

Tests cover:
- Null/undefined inputs
- Empty arrays/objects
- Boundary conditions
- Error cases

### 4. Integration Testing

Some tests verify multiple systems working together:

```typescript
// Test that effects trigger checks, which trigger more effects
const effects: Effect[] = [
  {
    op: "conditionalEffects",
    cases: [{
      when: { op: "flag", path: "flag1", value: true },
      then: [{ op: "setFlag", path: "result", value: true }]
    }]
  }
];
```

## Writing New Tests

When adding new features:

1. **Add tests for the new feature**
2. **Test success and failure paths**
3. **Test edge cases**
4. **Use test helpers for setup**
5. **Keep tests isolated and independent**

### Example Test Structure

```typescript
import { describe, it, expect } from "vitest";
import { functionToTest } from "./module";
import { makeTestSave, makeTestStoryPack, makeTestActor } from "./test-helpers";

describe("module", () => {
  describe("functionToTest", () => {
    it("should handle normal case", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = functionToTest(save);

      expect(result).toBeDefined();
      // ... assertions
    });

    it("should handle edge case", () => {
      // ... test edge case
    });
  });
});
```

## Known Test Failures

Some tests in `engine.test.ts` may fail due to:
- Features that have changed
- Features not yet fully implemented
- Test expectations that need updating

These are being tracked and will be addressed as the engine evolves.

