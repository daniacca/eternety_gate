# Eternity Gate Engine

A deterministic, runtime-safe game engine for interactive fiction and RPG-style narrative games. Built for React Native compatibility with a pure functional, immutable state machine architecture.

## Overview

The Eternity Gate Engine is a TypeScript-based game engine that powers narrative-driven games with:
- **Scene-based storytelling** with conditional text and choices
- **D100-based skill checks** with degrees of success/failure
- **Turn-based tactical combat** on a grid
- **Magic system** with channeling and effect checks
- **World events** and run variants
- **Deterministic RNG** for reproducible gameplay

## Key Features

### 🎲 Deterministic & Reproducible
- All randomness is seeded and tracked
- Same seed + counter = same results
- Perfect for save/load, replays, and debugging

### 🧩 Pure Functional Architecture
- Immutable state updates
- No side effects (except RNG counter)
- Easy to test and reason about

### 📱 React Native Compatible
- No Node.js dependencies
- No file system access
- Pure TypeScript/JavaScript

### 🎯 Type-Safe
- Full TypeScript coverage
- Comprehensive type definitions
- IDE autocomplete support

## Installation

```bash
pnpm add @eg/engine
```

## Quick Start

```typescript
import { createNewGame, applyChoice, listAvailableChoices } from '@eg/engine';
import type { StoryPack, Party, Actor } from '@eg/engine';

// Create a story pack (your game content)
const storyPack: StoryPack = {
  id: "my_story",
  title: "My Story",
  version: "1.0.0",
  startSceneId: "intro",
  // ... see types.ts for full structure
};

// Create party and actors
const party: Party = {
  actors: ["PC_1"],
  activeActorId: "PC_1"
};

const actorsById: Record<string, Actor> = {
  PC_1: {
    id: "PC_1",
    name: "Hero",
    kind: "PC",
    stats: { STR: 50, TOU: 50, /* ... */ },
    // ...
  }
};

// Create a new game
const save = createNewGame(
  storyPack,
  12345, // RNG seed
  party,
  actorsById,
  {}, // item catalog
  { id: "default", weapons: [], armors: [] } // content pack
);

// List available choices
const choices = listAvailableChoices(storyPack, save);

// Apply a choice
const newSave = applyChoice(storyPack, save, choices[0].id);
```

## Core Concepts

### Story Pack
A `StoryPack` contains all game content: scenes, choices, checks, effects, and system configuration. It's the "data file" for your game.

### Game Save
A `GameSave` represents the complete game state at a point in time:
- Current scene
- Flags and counters
- Inventory
- Party and actors
- Combat state (if in combat)
- RNG seed and counter

### Effects
Effects are actions that modify game state:
- `setFlag` - Set a boolean flag
- `addCounter` - Modify a counter
- `addItem` / `removeItem` - Inventory management
- `goto` - Change scene
- `combatStart` - Start combat
- And more...

### Checks
Checks are skill tests using D100 rolls:
- `single` - Basic stat/skill check
- `opposed` - Attacker vs defender
- `sequence` - Multiple checks in order
- `magicChannel` - Magic channeling
- `magicEffect` - Magic casting
- `combatAttack` - Combat attack resolution

### Conditions
Conditions evaluate game state:
- `flag` - Check boolean flag
- `counterGte` / `counterLte` - Compare counters
- `and` / `or` / `not` - Logical operators

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## API Reference

### Core Functions

#### `createNewGame(storyPack, seed, party, actorsById, itemCatalogById, contentPack?)`
Creates a new game save from a story pack.

#### `listAvailableChoices(storyPack, save): Choice[]`
Returns choices available in the current scene (filtered by conditions).

#### `applyChoice(storyPack, save, choiceId): GameSave`
Applies a choice and returns the updated save.

#### `getCurrentScene(storyPack, save): { scene, text }`
Gets the current scene with resolved conditional text blocks.

### Combat Functions

#### `startCombat(storyPack, save, participantIds, startedBySceneId?, grid?, placements?): GameSave`
Starts a combat encounter.

#### `getCurrentTurnActorId(save): ActorId | null`
Gets the actor ID whose turn it is in combat.

#### `advanceCombatTurn(save): GameSave`
Advances to the next turn in combat.

#### `runNpcTurn(storyPack, save, rng): GameSave`
Runs an NPC's turn in combat (AI decision making).

### Utility Functions

#### `evaluateCondition(condition, save): boolean`
Evaluates a single condition.

#### `evaluateConditions(conditions, save): boolean`
Evaluates a condition or array of conditions (OR logic for arrays).

#### `applyEffect(effect, storyPack, save, rng): { save, emittedEffects? }`
Applies a single effect.

#### `applyEffects(effects, storyPack, save, rng): GameSave`
Applies multiple effects in sequence.

#### `performCheck(check, storyPack, save, rng): CheckResult | null`
Performs a check and returns the result.

## Testing

```bash
pnpm test
```

The engine includes comprehensive unit tests for all core modules.

## Type Definitions

All types are exported from the main package. Key types include:

- `StoryPack` - Game content structure
- `GameSave` - Complete game state
- `Scene` - A scene in the story
- `Choice` - A player choice
- `Effect` - State modification action
- `Check` - Skill test definition
- `Condition` - State evaluation
- `Actor` - Character definition
- `Party` - Player party
- `CombatState` - Combat encounter state

See `src/runtime/types.ts` for complete type definitions.

## Contributing

When contributing to the engine:

1. Maintain immutability - never mutate input state
2. Keep functions pure - no side effects (except RNG counter)
3. Update tests - add tests for new features
4. Update types - ensure TypeScript types are accurate
5. Follow patterns - see existing code for style

## License

[Your License Here]

