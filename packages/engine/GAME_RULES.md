# Eternity Gate Game Rules

This document is a player-facing reference for the game rules. It is written to be reused in story guides, tooltips, and external documentation.

## Core Principles

- **Deterministic outcomes**: The same seed and the same choices produce the same results.
- **D100 system**: Most checks roll a percentile (1–100) and compare against a target.
- **Degrees of Success (DoS)**: Many checks measure how well you succeed, not just if you succeed.

## Character Stats

Stats are percentile values (0–100+). They are used directly as check targets or as inputs for derived values.

- **STR (Strength)**: Physical power, melee damage, and heavy tasks.
- **TOU (Toughness)**: Resilience and damage mitigation.
- **AGI (Agility)**: Movement, dodging, and precision.
- **INT (Intelligence)**: Knowledge, reasoning, and complex tasks.
- **WIL (Willpower)**: Mental resilience and magic channeling.
- **CHA (Charisma)**: Social influence and persuasion.
- **WS (Weapon Skill)**: Melee accuracy and parry capability.
- **BS (Ballistic Skill)**: Ranged accuracy.
- **INI (Initiative)**: Turn order in combat.
- **PER (Perception)**: Awareness and detection.

### Stat Usage Summary

- **Checks**: Most checks roll against a stat or a skill (skill keys map to a stat baseline).
- **Combat**: WS for melee, BS for ranged, AGI for dodge, INI for initiative.
- **Magic**: WIL is used for channeling and many spell interactions.

## Skills, Talents, and Traits

### Skills

- Skills represent trained capability (e.g., `SKILL:<skillId>`).
- Checks can use a stat directly or a skill key.
- Skills may be modified by equipment, temporary modifiers, or talents.

### Talents

- Talents are learned abilities that modify rules or provide new actions.
- Talents often require prerequisites (stats, traits, or other talents).
- Buying talents uses XP and is tracked per actor.

### Traits

- Traits are innate or story-driven properties.
- Traits can grant passive bonuses, rule exceptions, or unlock actions.

## General Check Rules

### Single Check (basic roll)

- Roll 1–100.
- **Success** if `roll <= target`.
- **DoS** = floor((target - roll) / 10).

### Multi Check

- Choose one of multiple stat/skill options.
- The chosen option is rolled like a Single Check.

### Condition Check

- Pass/fail based on the game state.
- No roll, no DoS/DoF (treated as 0).

### Opposed Check

- Two actors roll.
- Attacker must succeed.
- If defender fails → attacker wins.
- If both succeed → compare DoS.

### Sequence Check

- Multiple checks resolved in order.
- Stop at first failure.

### Magic Checks

- **Channel** checks accumulate DoS over multiple turns.
- **Effect** checks require a minimum DoS (casting number).
- Extra DoS can increase spell strength.

## Modifiers

Checks can be modified by:

- **Difficulty** (e.g., Easy → Hard).
- **Temporary modifiers** (short-lived bonuses/penalties).
- **Equipment bonuses**.
- **Combat modifiers** (range, cover, outnumbering, stances).

## Combat Rules

### Turn Structure

Each turn includes:

- **Movement points** (based on AGI).
- **One action** (attack, defend, aim, channel, cast, etc.).

### Initiative

- Initiative is based on INI plus a d10 roll.

### Stances

Stances persist until the actor’s next turn:

- **Defend**: harder to hit the actor.
- **All-Out**: easier to hit enemies, cannot defend.
- **Aim**: improves accuracy for a later attack.

### Attacking and Defense

- Attacks use **WS** (melee) or **BS** (ranged).
- Defenders can **parry** or **dodge** depending on state.
- Parry can be temporarily disabled to prevent chaining.

### Movement

- Combat uses a grid.
- Distance uses Chebyshev rules (diagonals count as 1).

### Combat Logs

- Combat outcomes are logged for narrative replay and UI display.

## Magic Rules

### Od Reserve (MC)

- Every sentient has an **Od reserve**: **MC_MAX** and **MC_CURRENT** (Magic Charges).
- **MC_MAX** = (INT bonus + WIL bonus + CHA bonus) × **Magic Core multiplier** + flat modifiers. Traits such as **Enhanced Magic Circuit(X)** add +X via modifier; **Magic Core(X)** multiplies the base sum by X (e.g. X=2 doubles the base). Talents such as **Arcane Pool** add +2 per rank (max 5 ranks) via modifier.
- **MC_CURRENT** regenerates only on **Long Rest**.
- Casting spends MC; channeled Mana (from Channeling) is converted to MC by **Magic Density** and spent first, then Od.

### Cast Modes

- **Fettered**: spend CN (minimum); safest, positive cast modifier when PM > CN.
- **Full Power**: spend PM (at least CN); cast modifier 0; phenomena on doubles or ≥2 DoF.
- **Push**: spend PM+2; cast modifier -20; **phenomena always**.

### Combat Magic

- **Channeling** is a full-round action that accumulates DoS; DoS are converted to MC using **Magic Density** (e.g. Normal 3 DoS→1 MC). Channel DoS reset when the actor does a non-channel, non-cast action, or after casting.
- **Casting** consumes MC (mana first, then Od), uses a d100 check with a **cast modifier** (PM − MC_SPENT)×10, and **overcast** = floor((MC_SPENT − CN)/2).
- **Phenomena** trigger by mode: Fettered on ≥2 DoF; Full Power on doubles or ≥2 DoF; Push always. Severity (minor/moderate/major) from DoF.
- **Anti-magic** (e.g. Untouchable aura): effective density **almost null** (channel gives 0 MC); cast still consumes Od and applies penalty.
- **Magic Resistance (MR)**: Compare MR to **emitted MC** (the magic charges spent on this cast, from Mana and/or Od). If **MR ≥ emitted MC** the spell is **completely negated** on that target. If MR < emitted MC: **effective MC** = emitted MC − MR; if effective MC **< base CN** the spell is **negated** (reduction dropped it below minimum). Otherwise only the excess is dispersed; **effective overcast** for that target = floor((effective MC − CN) / 2).
- **Scrolls and spell consumables**: Activating a scroll (or similar item) does **not** consume the caster's MC; the item provides the spell formula and the energy (treated as a cast at CN, overcast 0). The caster still rolls for success.
- **Magic Conduct** (talent): On a successful cast, you may spend 1 Fate Point to add **+1d5 MC** to that cast; this increases overcast and the amount deducted from your reserve (channel first, then Od).
- **Double cast**: Required base MC = **CN₁ + CN₂**. Extra MC (effective MC spent − total CN) is split **50/50** between the two spells (round down each share). Each spell's overcast = floor(its extra MC / 2). E.g. Full Power PM 8, spells CN 2 and CN 3 → total CN 5, MC spent 8, extra 3 → 1 and 2 extra per spell → overcast 0 and 1.
- Traits (e.g., *Untouchable*) affect channeling and casting.

### NPCs and bestiary

- NPC weavers get **MC_MAX** from INT+WIL+CHA when not set (same as PCs). Templates can override **mcMax** (and **mcCurrent**) in resources for custom pools.

### Save migration

- Older saves without `mcMax`/`mcCurrent`: call **migrateSaveMcReserve(save, catalogs)** after load to set MC from INT+WIL+CHA.

### Narrative Magic

Some choices are **magic choices**:

- The engine verifies the spell is known and allowed for narrative use.
- On success, the choice can set flags, apply narrative effects, or jump to a new scene.
- On failure, the choice can still apply consequences.

## Narration Rules

### Scenes and Choices

- Stories are built from **scenes** with text and **choices**.
- Choices can be gated by **conditions** (flags, counters, and logical rules).
- Some choices include checks; failure can branch or apply consequences.
- Combat-only choices are blocked when it is not the player’s turn.

### Flags and Counters

- **Flags** are boolean state markers.
- **Counters** are numeric state values.
- Conditions can combine logic with **and/or/not**.

### World Events and Variants

- **World events** trigger when conditions are met.
- **Run variants** allow different starting tags/effects for a story.

## Progression and Rewards

- **XP** is tracked per actor.
- Talents can be learned with XP (if prerequisites are met).
- Spells can be learned through narrative or effects.
