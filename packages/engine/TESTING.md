# Testing Guide

## Test Coverage

The engine package includes comprehensive unit tests for all core modules:

### Representative Test Suites

**Core Runtime Tests:**
- **conditions.test.ts** - Condition evaluation system
- **conditions.actor.test.ts** - Actor condition system
- **effects.test.ts** - Effect application system
- **checks.test.ts** - Check resolution system
- **rng.test.ts** - Random number generation
- **selectors.test.ts** - State selection utilities
- **engine.test.ts** - Engine core functionality

**Combat System Tests:**
- **combat/combat.test.ts** - Combat state management
- **combat/movement.test.ts** - Grid movement utilities
- **combat/damage.test.ts** - Damage calculation and application
- **combat/criticalDamage.test.ts** - Critical damage handling
- **combat/equipment.test.ts** - Equipment resolution
- **combat/aim.test.ts** - Aim stance mechanics
- **combat/getProne.test.ts** - Prone/stand logic
- **combat/castSpell.test.ts** - Combat spell casting
- **combat/forceField.test.ts** - Force field mitigation
- **combat/validation.test.ts** - Combat validation
- **combat/narration.test.ts** - Combat narration
- **combat/swiftAttack.test.ts** - Swift attack mechanics
- **combat/weaponQualities.test.ts** - Weapon quality rules

**Character System Tests:**
- **characters/modifiers.test.ts** - Modifier calculation
- **characters/actions.test.ts** - Character actions
- **characters/xp.test.ts** - XP spend/grant flow
- **characters/prerequisites.test.ts** - Prerequisite evaluation
- **characters/regeneration.test.ts** - Regeneration rules
- **characters/naturalWeapons.test.ts** - Natural weapon profiles
- **characters/naturalAbilities.test.ts** - Natural abilities
- **characters/bonuses.test.ts** - Characteristic bonuses
- **characters/talentModifiers.test.ts** - Talent modifiers

**Magic System Tests:**
- **magic/castSpellNarrative.test.ts** - Narrative spell casting flow
- **magic/resistance.test.ts** - Resistance/defense rules

**Total: Comprehensive test coverage across all modules**

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

