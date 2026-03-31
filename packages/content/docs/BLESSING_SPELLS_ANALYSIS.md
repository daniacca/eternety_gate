# Blessing Spells – Rules Recap and Analysis

This document recaps how **blessing**-type effects work in the engine and catalogs, and flags possible adjustments. No code changes—analysis only.

---

## 1. What is a “blessing” in the engine?

- **Effect kind:** In `EffectDefinition`, `kind: "blessing"` is a **semantic label**. The engine does **not** branch on `effectDef.kind === "blessing"` for resolution. It branches on:
  - `effectDef.applyConditions`
  - `effectDef.tempModifier`
  - `effectDef.aura`
  - `effectDef.specialOp`
- So “blessing” = beneficial / buff / utility effect; the actual behaviour is driven by these fields.

---

## 2. List of blessing effects (catalog)

| Effect ID | Discipline | Main mechanic | Spell(s) using it |
|-----------|------------|----------------|-------------------|
| effect:sense_magic | VATES | Narrative only (setFlag) | vates_sense_magic |
| effect:pyra_fire_shield | PYRA | applyConditions: fire_shield | pyra_fire_shield |
| effect:kinesis_force_shield | KINESIS | applyConditions: force_field | kinesis_force_shield |
| effect:kinesis_blink_step | KINESIS | specialOp: combatBlinkStep | kinesis_blink_step |
| effect:corpus_dragon_skin | CORPUS | aura + applyConditions: force_shield | corpus_dragon_skin |
| effect:mentis_veil_invisibility | MENTIS | aura + applyConditions: invisibility | mentis_veil_invisibility |
| effect:vates_premonition | VATES | tempModifier: +20 all tests | vates_premonition |
| effect:vates_perfect_timing | VATES | applyConditions: perfect_timing | vates_perfect_timing |
| effect:vates_precognition | VATES | applyConditions: precognition | vates_precognition |
| effect:corpus_steel_body | CORPUS | aura + applyConditions: steel_body | corpus_steel_body |
| effect:corpus_warp_speed | CORPUS | aura + applyConditions: warp_speed | corpus_warp_speed |
| effect:corpus_purity_of_body | CORPUS | specialOp: combatPurgeConditions | corpus_purity_of_body |
| effect:corpus_beast_form | CORPUS | applyConditions: beast_form | corpus_beast_form |
| effect:corpus_song_of_giant | CORPUS | applyConditions: giant_form | corpus_song_of_giant |
| effect:pyra_fiery_form | PYRA | applyConditions: fiery_form | pyra_fiery_form |
| effect:kinesis_flight | KINESIS | applyConditions: flight | kinesis_flight |
| effect:vates_weave_of_fate | VATES | applyConditions: weave_of_fate (+1 temp Fate) | vates_weave_of_fate |
| effect:vates_vision | VATES | Narrative only | vates_vision |
| effect:santic_sanctuary | SANTIC | aura + applyConditions: sanctuary | santic_sanctuary |
| effect:santic_word_of_god | SANTIC | aura + applyConditions: word_of_god | santic_word_of_god |
| effect:santic_avatar | SANTIC | applyConditions: avatar | santic_avatar |
| effect:santic_summon | SANTIC | specialOp: combatSummonDivine | santic_summon |

**Note:** `effect:daemonology_cursed_earth` is `kind: "malediction"` but applies an aura condition (cursed_earth) with the same aura-power logic as sanctuary/word_of_god; included below where relevant.

---

## 3. How blessing effects are applied (engine rules)

### 3.1 Conditions (`applyConditions`)

- For each `applyConditions` entry, the engine:
  - Computes **base** stacks/duration from `conditionSpec.value`, `conditionSpec.durationRounds`, and `effectStatBonus`.
  - Applies **per-condition scaling** (see table below).
  - Optionally applies a **trigger** (e.g. `trigger.overcast` = only if `targetOvercast >= X`).
  - If `effectDef.aura?.applyToAllies`, only the **caster** gets the condition in the first pass; `updateAuraEffects` then propagates to allies in radius (using condition params such as `aura.radius`).

**Scaling by condition (current code):**

| Condition | Stacks | Duration | Notes |
|-----------|--------|----------|--------|
| force_field | 1 | baseDuration + overcast | baseDuration = durationRounds + effectStatBonus |
| force_shield | baseDuration + overcast | baseDuration + overcast | Same base; stacks = duration |
| prone / fatigue (no duration) | baseStacks + floor(overcast/2) | — | No expiry |
| steel_body / warp_speed | 1 + overcast | scaleCondition(…) → durationTurns | scaleCondition: stacks += floor(OC/2), duration += OC |
| beast_form / giant_form / fiery_form / flight / weave_of_fate | 1 | baseDuration + overcast | baseDuration from effect or 1 |
| **Default** (other conditions) | scaleCondition stacks | scaleCondition durationTurns | stacks += floor(OC/2), duration += OC |

**scaleCondition (generic):**  
`stacks = baseStacks + floor(overcast/2)`, `durationTurns = baseDuration + overcast`.

**Special cases:**

- **fire_shield:** Params include `wilBonus`, `overcast` (for backlash scaling).
- **invisibility:** Params include `wilBonus`.
- **sanctuary / word_of_god / cursed_earth:** Params include `auraKind`, **auraPower: effectiveDoS**, `wilBonus`, `overcast`.  
  **auraPower** is used in `updateAuraEffects` to decide **which aura wins** when multiple auras overlap the same target (higher auraPower wins). So **caster DoS** still drives aura dominance, not overcast/MC.
- **force_field:** Special payload `{ x: 35 + targetOvercast*5, y: max(0, 20 - targetOvercast*2) }` (soak/parry style values).
- **giant_form:** Size increase = `min(10 - currentSize, 2 + targetOvercast)`; stat deltas from size; condition applied with `statDeltas`, `previousSize`, etc.
- **weave_of_fate:** Does not go through `addConditionToActor` in the main branch; handled in a separate block: +1 temp Fate Point, then condition added with `originalFatePoints`, `tempFate: 1`. Duration/stacks from same formula as fiery_form (base + overcast).

### 3.2 Temporary modifier (`tempModifier`)

- Used by **vates_premonition** (and any other effect that sets `tempModifier`).
- **Duration:** `fixedDurationRounds ?? (durationRounds + effectStatBonus)` then **+ targetOvercast**.
- **Value:** For `spell:vates_premonition` only: `value + targetOvercast * 5`. Other tempModifier effects use fixed `value`.
- Applied to `actor.status.tempModifiers` with `scope: "all"` (all checks).

### 3.3 Aura propagation

- If effect has `aura: { applyToAllies, radiusFromEffectStat, includeCaster }`, the caster gets the condition with `conditionParams.aura = { radius, includeCaster }`.
- **radius** = `effectStatBonus` (if `radiusFromEffectStat`) or `aura.radiusSquares`.
- Each turn, `updateAuraEffects` runs: actors in radius (and optionally caster) receive the same condition/aura effect. For **sanctuary** and **cursed_earth**, when multiple casters overlap, the aura with **higher auraPower** (effectiveDoS) wins per target.

### 3.4 Special ops (blessing-related)

- **combatBlinkStep:** Teleport caster (no condition scaling; spell-specific).
- **combatPurgeConditions:** Strip certain negative conditions from allies in radius.
- **combatSummonDivine:** Summon entity (no condition list).

---

## 4. Inconsistencies and design notes

### 4.1 Scaling formulas are condition-specific

- **Duration:** Most blessings use `baseDuration + overcast`. Some use `scaleCondition` (which adds overcast to duration and floor(overcast/2) to stacks). So “duration scales with overcast” is consistent in spirit, but the exact formula varies (e.g. steel_body/warp_speed use scaleCondition for duration but then override stacks to `1 + overcast` for characteristic scaling).
- **Stacks:** force_shield uses stacks = duration; steel_body/warp_speed use `1 + overcast` for stat bonuses; default uses `baseStacks + floor(overcast/2)`. So “stacks” meaning is not uniform across blessings.

### 4.2 Aura power = effectiveDoS (caster DoS)

- For **sanctuary**, **word_of_god**, and **cursed_earth**, the condition is stored with **auraPower: effectiveDoS**.
- In **updateAuraEffects**, when two auras of the same kind (or competing kinds) affect the same target, the one with **higher auraPower** wins. So **caster DoS** (not overcast, not MC) determines aura dominance.
- **Implication:** With the move to “resist = fail/pass, no DoS comparison”, DoS is less central for offensive spells. For these auras, DoS is still central for “who wins when auras overlap.” If you want **MC/overcast** to drive blessing strength everywhere, you could consider making **auraPower** derived from overcast (or emitted MC) instead of effectiveDoS, so that “more resource spent” = stronger aura in overlaps too.

### 4.3 No explicit “blessing” section in GAME_RULES

- **GAME_RULES.md** does not mention “blessing” or buff spells. Only generic magic (cast, overcast, MR, resist, etc.) is described. Adding a short “Blessing / buff spells” subsection could clarify that:
  - Blessings apply conditions or temp modifiers to valid targets (self and/or allies).
  - Duration and magnitude scale with overcast (and effectStat where defined).
  - Aura blessings propagate in radius; overlapping auras are resolved by aura power (currently DoS).

### 4.4 durationRounds: 0 (convention, now documented)

The engine uses the spell's baseCN for the base (see §7); content authors can rely on this.

### 4.5 effectStatBonus and base duration

- Several blessings use **effectStatBonus** (WIL or other) in:
  - base duration (e.g. durationRounds + effectStatBonus),
  - aura radius (radiusFromEffectStat),
  - condition params (wilBonus for fire_shield, invisibility, sanctuary, etc.).
- So high WIL (or the effect stat) makes blessings last longer and (where applicable) have larger radius or stronger effect. This is consistent; only the aura-power = DoS is the outlier if you want everything to tie to MC/overcast.

---

## 5. Summary table: blessing scaling at a glance

| Effect | Primary scaling | Duration | Stacks / magnitude | Aura / special |
|--------|------------------|----------|---------------------|----------------|
| sense_magic, vates_vision | — | — | Narrative only | — |
| pyra_fire_shield | overcast, wilBonus | 0 (persistent until hit?) | 1 | — |
| kinesis_force_shield | overcast, effectStat | base + OC | 1 | — |
| kinesis_blink_step | — | — | specialOp | — |
| corpus_dragon_skin | overcast, effectStat | base + OC | base + OC (force_shield) | aura, radius = effectStat |
| mentis_veil_invisibility | wilBonus | 0 → default | 1 | aura |
| vates_premonition | overcast | base + effectStat + OC | tempMod: value + OC×5 | — |
| vates_perfect_timing | effectStat | 0 → default | 1 | — |
| vates_precognition | effectStat, overcast | base + OC | 1 | — |
| corpus_steel_body | overcast | scaleCondition | 1 + OC (for STR/TOU) | aura |
| corpus_warp_speed | overcast | scaleCondition | 1 + OC (for WS/BS/AGI) | aura |
| corpus_purity_of_body | — | — | specialOp purge | radius |
| corpus_beast_form | effectStat (WIL), overcast | base + OC | 1 | — |
| corpus_song_of_giant | overcast | base + OC | 1 | size += 2 + OC |
| pyra_fiery_form | effectStat, overcast | base + OC | 1 | — |
| kinesis_flight | effectStat, overcast | base + OC | 1 | — |
| vates_weave_of_fate | overcast | base + OC | 1 | +1 temp Fate |
| santic_sanctuary | wilBonus, overcast, **effectiveDoS** | 0 | 1 | aura, **auraPower = DoS** |
| santic_word_of_god | wilBonus, overcast, **effectiveDoS** | 0 | 1 | aura, **auraPower = DoS** |
| santic_avatar | effectStat + overcast | base + OC | 1 | — |
| santic_summon | — | — | specialOp | — |

---

## 6. Suggested adjustments (design only)

1. **Aura power:** Consider defining **auraPower** from **overcast** (or emitted MC) instead of **effectiveDoS**, so blessing strength in overlaps aligns with “more MC spent = stronger effect” and stays consistent with the resist rework.
2. **Documentation:** Add a “Blessing / buff spells” subsection in GAME_RULES describing: application to self/allies, scaling with overcast and effectStat, and aura overlap rule (and what “aura power” is).
3. **Unify scaling where possible:** Optionally document (or standardise) one convention for “duration” and “stacks” across blessing conditions (e.g. “duration = base + overcast” and “stacks = 1 + floor(overcast/2)” unless the condition has a specific override), to reduce special cases.
4. **durationRounds: 0:** Document that 0 means “use default base (e.g. 1) and scale with overcast” so content authors know the convention.

---

## 7. Implemented updates (as of latest changes)

1. **Aura power:** Now **auraPower = emitted MC + floor(DoS/2)**. Emitted MC dominates; DoS is a small tie-breaker so that at equal MC the caster with better control wins when auras overlap.
2. **GAME_RULES:** A “Blessing and buff spells” bullet was added: application to self/allies, standardized duration/stacks formula, aura overlap, aura power formula, and **durationRounds: 0** convention.
3. **Standardized duration and stacks:** One convention for blessing conditions:
   - **Base from spell baseCN** (higher CN → higher base, so high-CN spells stay meaningful with less overcast room). Duration bands: 0–1→1, 2–4→2, 5–7→3, 8–10→4, 10+→5. **Stacks bands:** 0–1→1, 2–4→3, 5–7→5, 8–10→6, 10+→7 (tuned so a high-PM character gets total stacks ≈5–8 across CN: e.g. CN 1 full power OC 5–7 → 6–8; CN 4 OC 2–4 → 5–7).
   - **duration** = baseDuration(baseCN) + effectStatBonus + overcast.
   - **stacks** = baseStacks(baseCN) + **overcast** (1:1 with OC so low-CN full-power casts land in the 6–8 range).
   - Exceptions: force_field → stacks = 1; force_shield → stacks = duration; prone/fatigue (no duration) → duration undefined; steel_body/warp_speed → duration from formula, stacks = 1 + overcast for characteristic scaling.
4. **durationRounds: 0** is documented in GAME_RULES and here: it means “use default base from baseCN and scale with overcast”.
