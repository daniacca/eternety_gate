# Eternity Gate Engine Architecture

This document provides a comprehensive guide to the Eternity Gate Engine architecture, patterns, and design decisions.

## Table of Contents

1. [Core Principles](#core-principles)
2. [Architecture Overview](#architecture-overview)
3. [Module Structure](#module-structure)
4. [Data Flow](#data-flow)
5. [Key Patterns](#key-patterns)
6. [State Management](#state-management)
7. [RNG System](#rng-system)
8. [Combat System](#combat-system)
9. [Check System](#check-system)
10. [Effect System](#effect-system)
11. [Extension Points](#extension-points)

## Core Principles

### 1. Immutability

All state updates are immutable. Functions never mutate input parameters; they return new objects with updated values.

```typescript
// ✅ Good
function updateFlag(save: GameSave, flag: string, value: boolean): GameSave {
  return {
    ...save,
    state: {
      ...save.state,
      flags: { ...save.state.flags, [flag]: value },
    },
  };
}

// ❌ Bad
function updateFlag(save: GameSave, flag: string, value: boolean): void {
  save.state.flags[flag] = value; // Mutation!
}
```

### 2. Determinism

The engine is fully deterministic. Given the same:

- Story pack
- Initial save state
- RNG seed and counter
- Sequence of choices

The result is always identical. This enables:

- Save/load functionality
- Replay systems
- Debugging with reproducible scenarios
- Testing with fixed seeds

### 3. Pure Functions

Functions are pure (except RNG counter advancement):

- No I/O operations
- No global state access
- No side effects
- Same inputs → same outputs

### 4. Type Safety

Full TypeScript coverage ensures:

- Compile-time error checking
- IDE autocomplete
- Self-documenting code
- Refactoring safety

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                    │
│  (React Native App, Web App, CLI Tool, etc.)            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    Engine API                           │
│  createNewGame, applyChoice, listAvailableChoices       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Runtime Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Engine   │  │ Effects  │  │ Checks   │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Combat   │  │Conditions│  │ Selectors│               │
│  └──────────┘  └──────────┘  └──────────┘               │
│  ┌──────────┐                                           │
│  │   RNG    │                                           │
│  └──────────┘                                           │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Type Definitions                       │
│  StoryPack, GameSave, Effect, Check, Condition, etc.    │
└─────────────────────────────────────────────────────────┘
```

## Module Structure

### `/runtime/engine.ts`

**Purpose**: Main entry point and game flow orchestration

**Key Functions**:

- `createNewGame()` - Bootstrap a new game
- `listAvailableChoices()` - Get available choices
- `applyChoice()` - Process player choice

**Responsibilities**:

- Game initialization
- Choice routing
- Combat guard (blocking actions when not player's turn)
- Delegating to specialized handlers

### `/runtime/effects.ts`

**Purpose**: Effect application system

**Key Functions**:

- `applyEffect()` - Apply single effect
- `applyEffects()` - Apply multiple effects with queue

**Pattern**: Registry-based handler system

```typescript
const effectHandlers: Record<Effect["op"], EffectHandler> = {
  setFlag: (effect, storyPack, save, rng) => {
    /* ... */
  },
  addCounter: (effect, storyPack, save, rng) => {
    /* ... */
  },
  // ...
};
```

**Features**:

- Effect queue processing
- Emitted effects (effects can emit other effects)
- Deterministic processing order

### `/runtime/checks.ts`

**Purpose**: Skill check resolution system

**Key Functions**:

- `performCheck()` - Execute a check
- `resolveActor()` - Resolve actor reference
- `getStatOrSkillValue()` - Get stat/skill with modifiers

**Check Types**:

- `single` - Basic D100 check
- `opposed` - Attacker vs defender
- `sequence` - Multiple checks in order
- `magicChannel` - Magic channeling with DoS requirements
- `magicEffect` - Magic casting with casting numbers
- `combatAttack` - Combat attack with defense

**Features**:

- Equipment bonuses
- Temporary modifiers
- Difficulty bands
- Critical success/failure
- Degrees of success/failure (DoS/DoF)

### `/runtime/conditions.ts`

**Purpose**: Condition evaluation system

**Key Functions**:

- `evaluateCondition()` - Evaluate single condition
- `evaluateConditions()` - Evaluate condition or array (OR logic)

**Condition Types**:

- `flag` - Boolean flag check
- `counterGte` / `counterLte` - Counter comparison
- `and` / `or` / `not` - Logical operators

**Features**:

- Nested conditions
- Path prefix handling (`flags.`, `counters.`)

### `/runtime/combat/combat.ts`

**Purpose**: Combat state management

**Key Functions**:

- `startCombat()` - Initialize combat
- `advanceCombatTurn()` - Next turn
- `getCurrentTurnActorId()` - Get current actor

**Features**:

- Initiative calculation
- Turn order management
- Round tracking
- Turn counter (monotonic)
- Stance management
- KO participant removal
- Combat end detection

### `/runtime/combat/actions.ts`

**Purpose**: Combat action handlers

**Key Functions**:

- `combatStart()` - Start combat effect handler
- `combatMove()` - Movement action
- `combatEndTurn()` - End turn action
- `combatDefend()` - Defend stance
- `combatAim()` - Aim stance
- `combatAllOut()` - All-out attack stance
- `combatRequestAttack()` - Attack action

**Features**:

- Turn validation
- Movement tracking
- Stance application
- Attack resolution with defense

### `/runtime/combat/damage.ts`

**Purpose**: Damage calculation and application

**Key Functions**:

- `applyCombatDamageIfHit()` - Apply damage on hit

**Features**:

- Weapon damage calculation
- Strength bonus application
- Armor soak reduction
- HP tracking
- KO detection
- Combat log narration

### `/runtime/combat/movement.ts`

**Purpose**: Grid movement utilities

**Key Functions**:

- `distanceChebyshev()` - Chebyshev distance
- `clampToGrid()` - Clamp position to grid

### `/runtime/combat/equipment.ts`

**Purpose**: Equipment resolution

**Key Functions**:

- `getActorWeapon()` - Get equipped weapon
- `getActorArmor()` - Get equipped armor
- `calculateWeaponDamage()` - Calculate damage

### `/runtime/combat/npcAi.ts`

**Purpose**: NPC AI for combat

**Key Functions**:

- `runNpcTurn()` - Execute NPC turn

### `/runtime/rng.ts`

**Purpose**: Deterministic random number generation

**Key Classes**:

- `RNG` - Mulberry32-based PRNG

**Features**:

- Seed-based determinism
- Counter-based seekability
- D100 rolling
- Integer range generation

### `/runtime/selectors.ts`

**Purpose**: State selection utilities

**Key Functions**:

- `getCurrentScene()` - Get current scene with resolved text

**Features**:

- Conditional text block resolution
- Scene lookup

### `/runtime/choices/handlers.ts`

**Purpose**: Choice routing system

**Key Functions**:

- `handleChoice()` - Route choice to appropriate handler

**Pattern**: Registry-based handler system

```typescript
const choiceHandlers: Record<ChoiceKind, ChoiceHandler> = {
  generic: handleGenericChoice,
  check: handleCheckChoice,
  combat: handleCombatChoice,
};
```

**Choice Kinds**:

- `generic` - Effects only
- `check` - Has checks
- `combat` - Has combatAttack checks

## Data Flow

### Game Initialization Flow

```
createNewGame()
  ├─> bootstrapActorsFromCast() - Load NPCs from story pack
  ├─> mergeWeapons() - Merge global + story weapons
  ├─> mergeArmors() - Merge global + story armors
  └─> Create GameSave with initial state
```

### Choice Application Flow

```
applyChoice()
  ├─> Validate choice exists and conditions met
  ├─> Combat guard (check if player's turn)
  ├─> Create RNG from save state
  ├─> handleChoice() - Route to handler
  │   ├─> Determine choice kind
  │   └─> Call appropriate handler
  │       ├─> handleGenericChoice() - Apply effects
  │       ├─> handleCheckChoice() - Perform checks, then effects
  │       └─> handleCombatChoice() - Combat-specific logic
  └─> Return updated save
```

### Effect Application Flow

```
applyEffects()
  ├─> Create effect queue
  ├─> While queue not empty:
  │   ├─> Shift effect from queue
  │   ├─> applyEffect() - Apply single effect
  │   │   ├─> Lookup handler in registry
  │   │   ├─> Call handler
  │   │   └─> Return { save, emittedEffects? }
  │   ├─> Update save
  │   └─> Add emitted effects to queue
  └─> Return final save
```

### Check Resolution Flow

```
performCheck()
  ├─> Route by check kind
  ├─> resolveActor() - Resolve actor reference
  ├─> getStatOrSkillValue() - Get stat/skill with modifiers
  ├─> computeTargetBreakdown() - Calculate target
  ├─> Roll D100
  ├─> evaluateRoll() - Determine success/failure
  │   ├─> Check criticals
  │   ├─> Calculate DoS/DoF
  │   └─> Build tags
  └─> Return CheckResult
```

### Combat Turn Flow

```
startCombat()
  ├─> Filter alive participants
  ├─> Calculate initiative
  ├─> Sort by initiative
  ├─> Initialize grid and positions
  ├─> Initialize turn state
  └─> Return save with combat state

advanceCombatTurn()
  ├─> Filter alive participants
  ├─> Check combat end conditions
  ├─> Advance to next participant
  ├─> Increment round if needed
  ├─> Reset turn state
  ├─> Clear stance for new actor
  ├─> Increment turn counter
  └─> Return updated save
```

## Key Patterns

### 1. Registry Pattern

Used for effect handlers and choice handlers:

```typescript
const handlers: Record<Type["op"], Handler> = {
  type1: handleType1,
  type2: handleType2,
  // ...
};

function process(type: Type) {
  const handler = handlers[type.op];
  return handler(type);
}
```

**Benefits**:

- Easy to extend (add new handler)
- Type-safe (TypeScript ensures all types handled)
- No large switch statements

### 2. Immutable Updates

All state updates use spread operators:

```typescript
const updatedSave: GameSave = {
  ...save,
  state: {
    ...save.state,
    flags: {
      ...save.state.flags,
      newFlag: true,
    },
  },
};
```

**Benefits**:

- No accidental mutations
- Easy to reason about
- Enables time-travel debugging

### 3. Effect Queue

Effects can emit other effects, processed in order:

```typescript
const queue: Effect[] = [...effects];
while (queue.length > 0) {
  const effect = queue.shift()!;
  const result = applyEffect(effect, storyPack, save, rng);
  if (result.emittedEffects) {
    queue.push(...result.emittedEffects);
  }
}
```

**Benefits**:

- Supports conditional effects
- Deterministic processing order
- Handles nested effect chains

### 4. Actor Reference Resolution

Actors can be referenced in multiple ways:

```typescript
type ActorRef =
  | { mode: "active" }
  | { mode: "byId"; actorId: ActorId }
  | { mode: "bestOfParty"; key: StatOrSkillKey }
  | { mode: "askPlayer"; key: StatOrSkillKey };
```

**Benefits**:

- Flexible actor selection
- Supports party mechanics
- Can defer to UI for player choice

### 5. Tag System

Checks and effects use tags for metadata:

```typescript
tags: ["combat:attack", "combat:defense=parry", "calc:base=50", "calc:target=50"];
```

**Benefits**:

- Debugging information
- UI display hints
- Logging and analytics

## State Management

### GameSave Structure

```typescript
type GameSave = {
  saveVersion: string;
  story: { id: StoryId; version: StoryVersion };
  state: {
    flags: Record<string, boolean>;
    counters: Record<string, number>;
    inventory: { items: ItemId[] };
    runVariant?: { id: string; tags: string[] };
  };
  party: Party;
  actorsById: Record<ActorId, Actor>;
  itemCatalogById: Record<ItemId, Item>;
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;
  runtime: GameRuntime;
};
```

### Runtime State

```typescript
type GameRuntime = {
  currentSceneId: SceneId;
  rngSeed: number;
  rngCounter?: number;
  history: {
    visitedScenes: SceneId[];
    chosenChoices: ChoiceId[];
  };
  firedWorldEvents: WorldEventId[];
  lastCheck?: CheckResult;
  lastPlayerCheck?: CheckResult | null;
  magic?: {
    accumulatedDoS: number;
  };
  combat?: CombatState;
  combatLog?: string[];
  combatTurnStartIndex?: number;
  combatEndedSceneId?: SceneId;
  combatLogSceneId?: SceneId;
};
```

### Combat State

```typescript
type CombatState = {
  active: boolean;
  participants: ActorId[];
  currentIndex: number;
  round: number;
  startedBySceneId?: SceneId;
  grid: Grid;
  positions: Record<ActorId, Position>;
  turn: {
    moveRemaining: number;
    actionAvailable: boolean;
  };
  stancesByActorId?: Record<ActorId, "defend" | "allOut">;
  turnCounter: number;
  parryDisabledUntilTurnCounterByActorId?: Record<ActorId, number>;
};
```

## RNG System

### Design Goals

1. **Determinism**: Same seed + counter = same result
2. **Seekability**: Can jump to any point in sequence
3. **Distribution**: Good statistical properties

### Implementation

Uses Mulberry32 PRNG algorithm:

```typescript
class RNG {
  private mulberry32(seed: number): number {
    let t = seed + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  rollD100(): number {
    return this.nextInt(1, 100);
  }
}
```

### Usage Pattern

```typescript
// Create RNG from save state
const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

// Use RNG
const roll = rng.rollD100();

// Update save with new counter
const updatedSave = {
  ...save,
  runtime: {
    ...save.runtime,
    rngCounter: rng.getCounter(),
  },
};
```

### Seekability

To replay from a specific point:

```typescript
// Original sequence
const rng1 = new RNG(12345, 0);
const roll1 = rng1.rollD100(); // counter = 1
const roll2 = rng1.rollD100(); // counter = 2

// Replay from counter 1
const rng2 = new RNG(12345, 1);
const roll2Again = rng2.rollD100(); // Same as roll2
```

## Combat System

### Turn Structure

Each turn has:

- **Movement points**: Based on AGI (floor(AGI/10), minimum 1)
- **Action**: One action per turn (attack, defend, aim, etc.)

### Initiative

Calculated as: `INI base + d10 roll`

Sorted by:

1. Initiative score (descending)
2. Base INI (descending)
3. Actor ID (ascending, for determinism)

### Stances

Stances persist until actor's next turn:

- **Defend**: -20 to hit against this actor
- **All-Out**: +20 to hit, cannot defend

### Defense

When attacked:

1. Check if parry allowed (not disabled)
2. Check if dodge allowed
3. Choose defense based on strategy:
   - `autoBest`: Use best available
   - `preferParry`: Prefer parry if available
   - `preferDodge`: Prefer dodge if available
4. Roll defense (WS for parry, AGI for dodge)
5. Compare DoS: attacker DoS > defender DoS = hit

### Parry Disabling

After parrying, parry is disabled until turn counter X:

- Prevents parry spam
- Tracked per actor
- Cleared when turn counter advances

## Check System

### Check Types

#### Single Check

Basic D100 roll against target:

- Target = stat/skill + difficulty modifier + temp modifiers
- Success if roll <= target
- DoS = floor((target - roll) / 10)

#### Opposed Check

Two actors roll, compare results:

- Attacker must succeed
- If defender fails → attacker wins
- If both succeed → compare DoS
- Attacker wins if attacker DoS > defender DoS
- Opposed DoS = attacker DoS - defender DoS (if attacker wins)

#### Sequence Check

Multiple checks in order:

- Stop at first failure
- Success only if all succeed

#### Magic Channel Check

Accumulates DoS for channeling:

- Must meet target DoS
- If insufficient → failure with DoF
- DoS kept for accumulation

#### Magic Effect Check

Casts magic effect:

- Must meet casting number DoS
- Extra DoS = total DoS - casting number DoS
- Extra DoS can upgrade effects

#### Combat Attack Check

Combat attack resolution:

- Roll attack (WS for melee, BS for ranged)
- Apply combat modifiers (range, cover, outnumbering, etc.)
- If hit → defender can parry/dodge
- Compare DoS for final result

### Modifiers

Applied in order:

1. Base stat/skill
2. Equipment bonuses
3. Temporary modifiers (scope: "check" or "all")
4. Difficulty modifier
5. Combat modifiers (for combat checks)

### Criticals

- **Auto Success**: Roll in autoSuccess array → success
- **Auto Fail**: Roll in autoFail array → failure
- **Epic Success/Fail**: Special criticals with bonus DoS/DoF

### Doubles (Phenomena)

When tens digit = ones digit (e.g., 11, 22, 33):

- Tagged as "doubles"
- Magic checks add phenomena tags
- Controlled vs Forced power mode affects severity

## Effect System

### Effect Types

#### State Effects

- `setFlag` - Set boolean flag
- `addCounter` - Modify counter
- `addItem` / `removeItem` - Inventory

#### Flow Effects

- `goto` - Change scene
- `conditionalEffects` - Conditional branching
- `chooseRunVariant` - Select run variant
- `applyVariantStartEffects` - Apply variant effects
- `fireWorldEvents` - Trigger world events

#### Combat Effects

- `combatStart` - Start combat
- `combatMove` - Move in combat
- `combatEndTurn` - End turn
- `combatDefend` - Defend stance
- `combatAim` - Aim stance
- `combatAllOut` - All-out attack stance
- `combatRequestAttack` - Attack action

### Effect Queue

Effects are processed in a queue:

1. Initial effects added to queue
2. Process queue in order
3. If effect emits more effects, add to queue
4. Continue until queue empty

This enables:

- Conditional effects
- Effect chains
- Deterministic processing

### Emitted Effects

Some effects emit other effects:

- `conditionalEffects` - Emits effects from matching case
- `fireWorldEvents` - Emits effects from triggered events
- `applyVariantStartEffects` - Emits variant start effects

## Extension Points

### Adding New Effect Types

1. Add type to `Effect` union in `types.ts`
2. Add handler to `effectHandlers` registry in `effects.ts`
3. Implement handler function
4. Add tests

### Adding New Check Types

1. Add type to `Check` union in `types.ts`
2. Add case to `performCheck()` in `checks.ts`
3. Implement check function
4. Add tests

### Adding New Condition Types

1. Add type to `Condition` union in `types.ts`
2. Add case to `evaluateCondition()` in `conditions.ts`
3. Implement evaluation logic
4. Add tests

### Adding New Combat Actions

1. Add effect type to `Effect` union
2. Add handler to `effectHandlers` registry
3. Implement action logic in `combat/actions.ts`
4. Add tests

## Testing Strategy

### Unit Tests

Each module has comprehensive unit tests:

- `conditions.test.ts` - Condition evaluation
- `effects.test.ts` - Effect application
- `checks.test.ts` - Check resolution
- `rng.test.ts` - RNG determinism
- `combat/*.test.ts` - Combat system
- `selectors.test.ts` - State selection

### Test Helpers

Located in `test-helpers/`:

- `FakeRng` - Deterministic RNG for tests
- `makeTestActor()` - Create test actors
- `makeTestStoryPack()` - Create test story packs
- `makeTestSave()` - Create test saves

### Testing Patterns

1. **Determinism**: Use fixed seeds
2. **Isolation**: Each test is independent
3. **Coverage**: Test success and failure paths
4. **Edge Cases**: Test boundary conditions

## Performance Considerations

### Immutability Overhead

Immutable updates create new objects, which has overhead. However:

- Modern JS engines optimize object creation
- Immutability enables better debugging
- Prevents entire classes of bugs
- Enables time-travel debugging

### Optimization Strategies

1. **Shallow Copying**: Only copy changed paths
2. **Structural Sharing**: Unchanged objects reused
3. **Lazy Evaluation**: Defer expensive computations
4. **Memoization**: Cache expensive calculations

## Future Enhancements

Potential areas for extension:

1. **Talent System**: Character talents/abilities
2. **Trait System**: Character traits
3. **Skill System**: Expanded skill mechanics
4. **Item System**: More item types and effects
5. **Quest System**: Quest tracking and rewards
6. **Dialogue System**: More complex dialogue trees
7. **Save Compression**: Compress save files
8. **Replay System**: Record and replay gameplay

## Conclusion

The Eternity Gate Engine is designed for:

- **Reliability**: Deterministic, testable, debuggable
- **Extensibility**: Easy to add new features
- **Performance**: Efficient immutable updates
- **Developer Experience**: Type-safe, well-documented

For questions or contributions, see the main repository.
