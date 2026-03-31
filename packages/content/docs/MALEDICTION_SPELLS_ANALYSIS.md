# Malediction Spells – Rules Recap and Analysis

This document recaps how **malediction**-type effects (and related debuff/offensive spells) work in the engine and catalogs, and flags what is already fixed vs what may still need adjustment. No code changes in this document—analysis only.

---

## 1. What is a “malediction” in the engine?

- **Effect kind:** In `EffectDefinition`, `kind: "malediction"` is a **semantic label** (harmful / debuff / control). The engine does **not** branch on `effectDef.kind === "malediction"` for resolution. Behaviour is driven by:
  - `effectDef.opposed` + resist path or specialOp
  - `effectDef.applyConditions` (prone, fatigue, bound, stunned, blind, shock, misfortune, etc.)
  - `effectDef.tempModifier` (e.g. −20 to all tests)
  - `effectDef.specialOp` (disarm, control mind, vision of terror, sunburst, daemonbane, hellchain, etc.)
  - `effectDef.aura` (e.g. cursed_earth)
  - Damage + move (e.g. force_push with damage and prone)

---

## 2. List of malediction effects and spells

| Effect ID | Spell(s) | baseCN | Main mechanic | Resist? |
|-----------|----------|--------|----------------|--------|
| effect:force_push | Atterraggio | 0 | applyConditions: prone (no duration) | No |
| effect:kinesis_force_push | Spinta di Forza, Sblocco | 2, 0 | damage + move + prone if overcast ≥ 3 | No |
| effect:pyra_sunburst | Raggio Solare | 5 | specialOp: TOU check, blind on fail | Custom modifier |
| effect:kinesis_disarm | Disarmo | 3 | specialOp combatDisarmAtRange | **Yes (fixed)** |
| effect:kinesis_force_bind | Blocco di Forza | 2 | applyConditions: bound | No |
| effect:mentis_suggestion | Suggestione | 3 | opposed + applyConditions: stunned | **Yes (fixed)** |
| effect:mentis_sensory_distortion | Distorsione dei Sensi | 3 | tempModifier −20 all tests | No |
| effect:mentis_control_mind | Controllo Mentale | 7 | specialOp combatControlMind | **Yes (fixed)** |
| effect:mentis_vision_of_terror | Visione del Terrore | 5 | specialOp: WIL check, shock on fail | Custom modifier |
| effect:vates_misfortune | Misfortune | 4 | opposed + applyConditions: misfortune | **Yes (fixed)** |
| effect:santic_daemonbane | Scaccia Demoni | 0 | specialOp combatDaemonbane | **Yes (fixed)** |
| effect:daemonology_cursed_earth | Terra Maledetta | 5 | aura: cursed_earth (auraPower) | No (aura) |
| effect:daemonology_hellchain | Catene Infernali | 4 | specialOp combatHellchain | **Yes (fixed)** |
| effect:daemonology_infernal_gaze | Sguardo Infernale | 2 | kind damage + specialOp, resist | **Yes (fixed)** |
| effect:daemonology_soul_rend | Lacerazione dell'Anima | 5 | kind damage + specialOp, resist | **Yes (fixed)** |

**Note:** `effect:disrupt` is malediction with fatigue; no spell uses it (spells use `effect:mentis_disrupt`, kind fatigue, for Disrupt). `effect:daemonology_infernal_gaze` and `effect:daemonology_soul_rend` are `kind: "damage"` but behave as resist maledictions.

---

## 3. How maledictions are applied (engine rules)

### 3.1 Resist spells (already reworked)

- **Rule:** Cast success as usual; then target makes **one resist check**. Effect **lands if and only if the target fails**. Resist modifier = **base penalty (from baseCN bands)** **−10× overcast** + MR + Untouchable. Effect magnitude (damage, duration, etc.) can still scale with defender DoF and overcast.
- **Using this path (generic or specialOp):** mentis_suggestion, vates_misfortune, kinesis_disarm, mentis_control_mind, santic_daemonbane, daemonology_hellchain, daemonology_infernal_gaze, daemonology_soul_rend.
- **Base penalty bands (same as in GAME_RULES):** 0–1 → 0, 2–4 → −10, 5–7 → −20, 8–10 → −30, 10+ → −40.

### 3.2 Condition maledictions (no resist)

- **force_push (prone):** applyConditions with prone, no duration. Uses **standard blessing formula** for stacks (baseStacks(baseCN) + overcast); duration undefined. So same scaling as other condition applications.
- **kinesis_force_bind (bound):** applyConditions bound; duration/stacks from **standard formula** (base from baseCN + effectStat + overcast).
- **kinesis_force_push:** Damage + move; **prone** only if **overcast ≥ 3** (trigger.overcast). So no resist; condition applied when trigger met.

### 3.3 Temp-modifier malediction

- **mentis_sensory_distortion:** tempModifier to all tests. **Value** = −20 **−5×overcast** (kept low since resist difficulty already scales with OC). Duration = (effect durationRounds + effectStatBonus) + overcast.

### 3.4 Special ops with resist (aligned with single rule)

- **Vision of Terror (combatVisionOfTerror):** Target rolls **WIL** vs Challenging. Modifier = **base penalty(baseCN) −10×overcast** + MR + Untouchable. Effect (shock) applies **on fail**. Aligned with the single resist rule.
- **Sunburst (combatSunburst):** Target rolls **TOU** vs Challenging. Modifier = **base penalty(baseCN) −10×overcast** + MR + Untouchable. Effect (blind) applies **on fail**. Blind duration = 1 + max(0, DoF). Aligned with the single resist rule.

### 3.5 Aura malediction

- **daemonology_cursed_earth:** Aura condition; **auraPower** = emitted MC + floor(DoS/2). Same overlap rule as sanctuary/word_of_god. No per-target resist check for “does the aura apply”; it applies in radius, with daemonic bonus to allies in radius.

---

## 4. Consistency check: what’s fixed, what to consider

### 4.1 Already aligned with resist rework

- All spells that use the **generic opposed path** (suggestion, misfortune) or a **specialOp** that was updated to the single rule (disarm, control mind, daemonbane, hellchain, infernal gaze, soul rend) now use:
  - **Win condition:** effect on target **fail** (no DoS vs DoS).
  - **Resist modifier:** base penalty from baseCN bands + **−10× overcast** + MR + Untouchable.

### 4.2 Resist formula (all aligned)

- **Vision of Terror** and **Sunburst** now use the single rule: **getResistBasePenalty(effectDef, spell.baseCN)** and **getResistCheckModifier(basePenalty, targetOvercast, MR, Untouchable)**. Effect on fail unchanged.

### 4.3 Condition and temp-modifier scaling

- **force_push, force_bind:** Use the **standardized blessing formula** for duration/stacks (base from baseCN + effectStat + overcast; stacks = baseStacks + overcast). So they are already consistent with the rest of the condition system.
- **Sensory distortion:** Value now scales **−5×overcast** (value = −20 − 5×OC), kept low since resist difficulty already scales with OC.

### 4.4 Removed unused effect

- **effect:disrupt** was removed from the catalog (unused; spells use **effect:mentis_disrupt**).

---

## 5. Summary table: malediction scaling and resist

| Spell / Effect | baseCN | Resist? | Modifier / scaling | Aligned with single rule? |
|----------------|--------|---------|--------------------|----------------------------|
| Atterraggio (force_push) | 0 | No | Stacks = baseStacks(0)+OC, no duration | N/A (condition) |
| Spinta / Sblocco (kinesis_force_push) | 2, 0 | No | Damage + move; prone if OC ≥ 3 | N/A |
| Raggio Solare (pyra_sunburst) | 5 | Yes | base + −10×OC | **Yes** |
| Disarmo (kinesis_disarm) | 3 | Yes | base + −10×OC | **Yes** |
| Blocco di Forza (kinesis_force_bind) | 2 | No | Standard duration/stacks | N/A (condition) |
| Suggestione (mentis_suggestion) | 3 | Yes | base + −10×OC | **Yes** |
| Distorsione (mentis_sensory_distortion) | 3 | No | tempMod −20 −5×OC, duration scales | N/A |
| Controllo Mentale (mentis_control_mind) | 7 | Yes | base + −10×OC | **Yes** |
| Visione del Terrore (mentis_vision_of_terror) | 5 | Yes | base + −10×OC | **Yes** |
| Misfortune (vates_misfortune) | 4 | Yes | base + −10×OC | **Yes** |
| Scaccia Demoni (santic_daemonbane) | 0 | Yes | base + −10×OC | **Yes** |
| Terra Maledetta (cursed_earth) | 5 | No | Aura (auraPower = MC + DoS/2) | N/A (aura) |
| Catene Infernali (daemonology_hellchain) | 4 | Yes | base + −10×OC | **Yes** |
| Sguardo Infernale (daemonology_infernal_gaze) | 2 | Yes | base + −10×OC | **Yes** |
| Lacerazione dell'Anima (daemonology_soul_rend) | 5 | Yes | base + −10×OC | **Yes** |

---

## 6. Implemented updates (as of latest changes)

1. **Vision of Terror:** Now uses the single resist rule (base penalty from baseCN + −10×overcast + MR + Untouchable). Effect on fail unchanged.
2. **Sunburst:** Resist modifier now includes base + −10×overcast + MR + Untouchable.
3. **Sensory distortion:** Malus scales with overcast: **value = −20 − 5×overcast** (kept low since resist difficulty already scales with OC).
4. **effect:disrupt:** Removed from the effects catalog (was unused).
