# Spell baseCN Analysis vs New MC Rules

Analysis of all **51 spells** in the catalog: baseCN vs effect kind, damage, area, and special mechanics. CN is now the **minimum MC (energy) required** to manifest the spell; overcast scales from extra MC only.

---

## 1. CN distribution (after redistribution 1–6)

| baseCN | Count | Spells (examples) |
|--------|-------|-------------------|
| 0 | 7 | force_push, sense_magic, mentis_disrupt, santic_daemonbane, vates_vision, kinesis_unlock, mentis_read_surface |
| 1 | 2 | pyra_flame_control, pyra_ignite (1d5 touch only) |
| 2 | 11 | kinesis_force_push, daemonology_infernal_gaze, corpus_mend, regeneration, kinesis_force_bind, vates_premonition, vates_perfect_timing, kinesis_force_shield, corpus_steel_body, corpus_warp_speed, corpus_dragon_skin |
| 3 | 7 | flame_bolt (2d10), kinesis_shockwave, pyra_fire_shield, kinesis_flight, kinesis_disarm, mentis_suggestion, mentis_sensory_distortion |
| 4 | 9 | daemonology_hellchain, mentis_veil_invisibility, pyra_fiery_form, santic_holy_fire, daemonology_dark_flame, santic_word_of_god, vates_precognition, vates_misfortune, corpus_haemorrhage |
| 5 | 9 | flame_cone, pyra_sunburst, mentis_vision_of_terror, pyra_explosion, santic_sanctuary, santic_avatar, daemonology_cursed_earth, daemonology_soul_rend |
| 6 | 1 | kinesis_blink_step (teleport) |
| 7 | 1 | mentis_control_mind |
| 8 | 4 | daemonology_possession, corpus_purity_of_body, corpus_beast_form, corpus_song_of_giant |
| 10 | 1 | vates_weave_of_fate |
| 12 | 3 | santic_holocaust, santic_summon, daemonology_summon |

---

## 2. By effect kind and power

### Damage effects

| Spell | baseCN | Effect | Dice / notes |
|-------|--------|--------|---------------|
| pyra_flame_control_touch (pyra_flame_control, pyra_ignite) | 1 / **0** | damage | 1d5 touch – **pyra_ignite is CN 0** (same effect) |
| flame_bolt | 1 | damage | 2d10 single |
| kinesis_force_push | 1 | malediction + damage | 1d10 + move 2 + prone at overcast 3 |
| flame_cone | 2 | damage | 2d10+5 cone |
| kinesis_shockwave | 2 | damage | 1d10 + push radius |
| santic_holy_fire | 3 | damage | 1d10 cone sanctified |
| daemonology_dark_flame | 3 | damage | 1d10 cone unholy |
| pyra_explosion | 5 | damage | 3d10+5 radius |
| corpus_haemorrhage | 3 | damage | opposed TOU, internal (WIL + DoF) |
| daemonology_infernal_gaze | **0** | damage | opposed WIL, line – **CN 0 for opposed damage** |
| santic_daemonbane | 0 | malediction | opposed WIL, conditional (spiritual instability) |
| daemonology_soul_rend | 5 | damage | opposed WIL vs divine |
| santic_holocaust | 12 | damage | area + backlash, sanctified |

**Observation:**  
- **pyra_ignite** (CN 0) and **pyra_flame_control** (CN 1) share effect `pyra_flame_control_touch` (1d5 touch). Same effect, different CN – narrative “cantrip” vs “spell” is the only distinction; under MC rules both cost 0 or 1 MC.  
- **daemonology_infernal_gaze** is opposed damage in a line at CN 0; other single-target opposed damage (e.g. soul_rend) are CN 5. Either infernal_gaze is intentionally cheap (niche vs non-daemonic) or a rebalance candidate.

### Heal / utility (self/ally)

| Spell | baseCN | Effect |
|-------|--------|--------|
| corpus_mend, regeneration | 1 | heal 1d10+WIL, half as RF |
| vates_premonition | 1 | +20 all tests 1 round |
| vates_perfect_timing | 1 | ranged ignore cover |
| vates_vision | 0 | narrative vision/message |
| sense_magic | 0 | detect magic (narrative/combat) |

These look consistent: strong buffs at 1, pure utility/narrative at 0.

### Buffs (blessing, self/aura)

| Spell | baseCN | Effect |
|-------|--------|--------|
| corpus_steel_body | 1 | STR+TOU +1 aura |
| corpus_warp_speed | 1 | WS/BS/AGI +1 aura |
| corpus_dragon_skin | 1 | force_shield aura (NaturalArmor from overcast) |
| pyra_fire_shield | 2 | fire_shield (backlash on ranged) |
| kinesis_force_shield | 1 | force_field 1 round |
| pyra_fiery_form | 3 | fiery_form (energy resist, melee bonus) |
| kinesis_flight | 2 | flight |
| vates_precognition | 3 | best-of-two rolls |
| vates_misfortune | 3 | opposed, worst-of-two + half soak |
| vates_weave_of_fate | 10 | temporary Fate Point |
| santic_word_of_god | 3 | aura: WIL gate to attack |
| santic_sanctuary | 5 | aura: protect allies, repel daemonic |
| santic_avatar | 5 | avatar form (no Frenzy) |
| daemonology_cursed_earth | 5 | aura: buff daemonic, suppress instability |
| daemonology_possession | 8 | possession, Frenzy, unnatural STR, daemonic |
| corpus_purity_of_body | 8 | purge conditions (area) |
| corpus_beast_form | 8 | beast form (major transform) |
| corpus_song_of_giant | 8 | giant form |

Tier is clear: minor buffs 1–2, strong forms/auras 3–5, major transforms/auras 8, Weave of Fate 10.

### Maledictions / control

| Spell | baseCN | Effect |
|-------|--------|--------|
| force_push | 0 | prone only |
| mentis_disrupt | 0 | fatigue (1d5 from effect:mentis_disrupt) |
| kinesis_force_bind | 1 | bound 3 rnd |
| kinesis_disarm | 2 | opposed disarm at range |
| mentis_suggestion | 2 | opposed stun 1 rnd |
| mentis_sensory_distortion | 2 | -20 all tests 2 rnd |
| mentis_veil_invisibility | 2 | invisibility aura |
| mentis_vision_of_terror | 3 | fear/shock radius |
| daemonology_hellchain | 4 | immobilize (specialOp) |
| mentis_control_mind | 7 | full-round, opposed, control |

Control Mind at 7 and Hellchain at 4 are the only high-CN control spells; the rest are 0–3. That fits “control mind” as a capstone.

### Summons and “capstone” effects

| Spell | baseCN | Effect |
|-------|--------|--------|
| santic_summon | 12 | summon divine spirit |
| daemonology_summon | 12 | summon daemon |
| santic_holocaust | 12 | large area + backlash |

All at 12: very high MC cost, appropriate for summons and Holocaust.

---

## 3. Reused effects, different CN

Same effectId used by multiple spells with **different baseCN**:

| Effect | Spells | baseCN |
|--------|--------|--------|
| effect:force_push | force_push, **kinesis_unlock** | 0, **0** (both 0 – unlock is “utility” use) |
| effect:mentis_disrupt | mentis_disrupt, **mentis_read_surface** | 0, **0** |
| effect:pyra_flame_control_touch | pyra_flame_control, **pyra_ignite** | 1, **0** |
| effect:corpus_mend | corpus_mend, **regeneration** | 1, 1 |

Only **pyra_ignite** is strictly “same effect, lower CN” (0 vs 1). So either ignite is meant to be a cheaper “spark” (e.g. narrative/utility) or CN should be aligned to 1.

---

## 4. Possible balance issues (for rebalance discussion)

1. **CN 0 damage / strong effects**  
   - **daemonology_infernal_gaze** (0): opposed WIL damage in a line. Very low MC for an attack.  
   - **santic_daemonbane** (0): conditional (spiritual instability) and opposed – niche, so 0 can be intentional.  
   - **pyra_ignite** (0): 1d5 touch, same effect as pyra_flame_control (1). Inconsistent unless “cantrip” is by design.

2. **CN 1 damage vs 2**  
   - **flame_bolt** (1): 2d10 single.  
   - **flame_cone** (2): 2d10+5 cone.  
   Cone is strictly better (area + flat); +1 CN is light. Could argue cone at 3 or bolt at 2 for a clearer step.

3. **Buffs at 1**  
   - **corpus_steel_body**, **corpus_warp_speed**, **corpus_dragon_skin**, **kinesis_force_shield** all at 1.  
   - **pyra_fire_shield** at 2.  
   If “persistent defense” is meant to cost more than “short force field”, current spread is fine; otherwise 1 vs 2 could be revisited.

4. **High CN (8, 10, 12)**  
   - 8: possession, purity_of_body, beast_form, song_of_giant – all major.  
   - 10: weave_of_fate (temp Fate Point).  
   - 12: summons + Holocaust.  
   No obvious errors; these match “high energy” and capstone role.

5. **Control Mind (7)**  
   - Single spell at 7; sits between mid (3–5) and capstone (8+).  
   Fits as “expensive but not summon-level”.

---

## 5. Balance principles (after redistribution 1–6)

- **CN 0:** Utility only: no damage (or trivial 1d5 touch if “cantrip” is explicit), no control beyond prone/fatigue. Detection, narrative, conditional/niche opposed (e.g. daemonbane) can stay 0.  
- **CN 1:** Basic single-target damage (e.g. 1d10–2d10), short buffs, bind, heal 1d10, minor buffs.  
- **CN 2:** Cone/small area damage, short teleport, disarm, -20 debuff, short invisibility, flight.  
- **CN 3:** Strong self-buff (fiery form), blind/fear area, 1d10 cone (holy/unholy), aura gate (word of god), precognition/misfortune, internal damage (haemorrhage).  
- **CN 4–5:** Area damage (3d10+), sanctuary/cursed_earth, avatar, soul_rend, hellchain.  
- **CN 7:** Control Mind (full-round, opposed control).  
- **CN 8:** Major transform (beast, giant), possession, purge conditions.  
- **CN 10:** Weave of Fate (temp Fate).  
- **CN 12:** Summons, Holocaust.

---

## 6. Rebalance applied (full pass)

The following changes were applied to align with the principles above:

| Spell | Old baseCN | New baseCN | Reason |
|-------|------------|------------|--------|
| **spell:flame_cone** (Respiro di Fuoco) | 2 | **3** | Strong cone (2d10+5) tiers with other CN 3 effects (blind/fear area, 1d10 holy/unholy cone); clearer step above single-target 2d10 (flame_bolt at 1). |
| **spell:daemonology_infernal_gaze** (Sguardo Infernale) | 0 | **1** | CN 0 = utility only, no damage. Opposed WIL damage in line is at least “basic single-target” tier. |
| **spell:pyra_ignite** (Accensione) | 0 | **1** | Same effect as pyra_flame_control (1d5 touch); align to 1 for consistency. |

All other spells already matched the principles (no change).

---

## 7. Redistribution across CN 1–6 (differentiate damage and buff tiers)

Spells formerly at CN 1–3 were spread across 1–6:

- **CN 1** = trivial only (1d5 touch).
- **CN 2** = 1d10-tier damage, short buffs, bind, heal.
- **CN 3** = 2d10 single-target, small area, flight, disarm, suggestion, -20 debuff.
- **CN 4** = 1d10 cone (holy/unholy), invisibility aura, fiery form, word of god, precog/misfortune, haemorrhage, plus existing hellchain.
- **CN 5** = strong area (2d10+5 cone, sunburst, vision of terror) and existing 5-tier (explosion, sanctuary, avatar, cursed_earth, soul_rend).
- **CN 6** = teleport (blink step) as top of low tier before Control Mind (7).

| Spell | Old → New baseCN | Rationale |
|-------|------------------|-----------|
| flame_bolt | 1 → **3** | 2d10 single = moderate damage. |
| corpus_dragon_skin, kinesis_force_push, kinesis_force_shield, kinesis_force_bind, daemonology_infernal_gaze | 1 → **2** | 1d10 / short buff / bind = light. |
| vates_premonition, vates_perfect_timing, corpus_mend, regeneration, corpus_steel_body, corpus_warp_speed | 1 → **2** | Short buffs / heal. |
| pyra_fire_shield, kinesis_shockwave, kinesis_disarm, mentis_suggestion, mentis_sensory_distortion, kinesis_flight | 2 → **3** | Moderate. |
| mentis_veil_invisibility | 2 → **4** | Invisibility aura = solid. |
| flame_cone | 3 → **5** | 2d10+5 cone = strong area. |
| pyra_fiery_form, santic_holy_fire, daemonology_dark_flame, santic_word_of_god, vates_precognition, vates_misfortune, corpus_haemorrhage | 3 → **4** | Solid tier. |
| pyra_sunburst, mentis_vision_of_terror | 3 → **5** | Area blind/fear = strong. |
| kinesis_blink_step | 2 → **6** | Teleport = top of low tier. |
| pyra_flame_control, pyra_ignite | 1 (unchanged) | 1d5 touch only. |

---

## Appendix: Full spell list (id, name, baseCN, effectId, target)

| Spell ID | Name | baseCN | Effect | Target |
|----------|------|--------|--------|--------|
| spell:flame_bolt | Dardo Infuocato | 3 | effect:flame_bolt (2d10 dmg) | single |
| spell:flame_cone | Respiro di Fuoco | 5 | effect:flame_cone (2d10+5 cone) | cone |
| spell:force_push | Atterraggio | 0 | effect:force_push (prone) | single |
| spell:sense_magic | Senso della Magia | 0 | effect:sense_magic | self |
| spell:corpus_dragon_skin | Pelle di Drago | 2 | effect:corpus_dragon_skin (force_shield aura) | self |
| spell:pyra_explosion | Esplosione di Fuoco | 5 | effect:pyra_explosion (3d10+5 radius) | radius |
| spell:pyra_fiery_form | Forma di Fuoco | 4 | effect:pyra_fiery_form | self |
| spell:pyra_flame_control | Controllo delle Fiamme | 1 | effect:pyra_flame_control_touch (1d5 touch) | single |
| spell:pyra_fire_shield | Scudo di Fuoco | 3 | effect:pyra_fire_shield | self |
| spell:pyra_sunburst | Raggio Solare | 5 | effect:pyra_sunburst (blind area) | radius |
| spell:kinesis_force_push | Spinta di Forza | 2 | effect:kinesis_force_push (1d10+move+prone@OC3) | single |
| spell:kinesis_shockwave | Shockwave | 3 | effect:kinesis_shockwave (1d10+push radius) | radius |
| spell:kinesis_force_shield | Scudo di Forza | 2 | effect:kinesis_force_shield | self |
| spell:kinesis_blink_step | Blink Step | 6 | effect:kinesis_blink_step | single |
| spell:kinesis_disarm | Disarmo | 3 | effect:kinesis_disarm (opposed) | single |
| spell:kinesis_force_bind | Blocco di Forza | 2 | effect:kinesis_force_bind (bound 3rnd) | single |
| spell:mentis_disrupt | Disrupt | 0 | effect:mentis_disrupt (1d5 fatigue) | single |
| spell:mentis_suggestion | Suggestione | 3 | effect:mentis_suggestion (opposed stun) | single |
| spell:mentis_sensory_distortion | Distorsione dei Sensi | 3 | effect:mentis_sensory_distortion (-20) | single |
| spell:mentis_veil_invisibility | Velo di Invisibilità | 4 | effect:mentis_veil_invisibility | radius |
| spell:mentis_control_mind | Controllo Mentale | 7 | effect:mentis_control_mind | single |
| spell:mentis_vision_of_terror | Visione del Terrore | 5 | effect:mentis_vision_of_terror | radius |
| spell:santic_holy_fire | Fuoco Sacro | 4 | effect:santic_holy_fire (1d10 cone sanctified) | cone |
| spell:santic_sanctuary | Santuario | 5 | effect:santic_sanctuary | radius |
| spell:santic_daemonbane | Scaccia Demoni | 0 | effect:santic_daemonbane (opposed, conditional) | single |
| spell:santic_word_of_god | Parola di Dio | 4 | effect:santic_word_of_god | radius |
| spell:santic_avatar | Avatar | 5 | effect:santic_avatar | self |
| spell:santic_holocaust | Olocausto | 12 | effect:santic_holocaust | radius |
| spell:santic_summon | Evoca Spirito Divino | 12 | effect:santic_summon | self |
| spell:daemonology_cursed_earth | Terra Maledetta | 5 | effect:daemonology_cursed_earth | radius |
| spell:daemonology_dark_flame | Fiamma Oscura | 4 | effect:daemonology_dark_flame (1d10 cone) | cone |
| spell:daemonology_infernal_gaze | Sguardo Infernale | 2 | effect:daemonology_infernal_gaze (opposed dmg line) | line |
| spell:daemonology_possession | Possessione | 8 | effect:daemonology_possession | self |
| spell:daemonology_hellchain | Catene Infernali | 4 | effect:daemonology_hellchain | single |
| spell:daemonology_soul_rend | Lacerazione dell'Anima | 5 | effect:daemonology_soul_rend | single |
| spell:daemonology_summon | Evoca Demone | 12 | effect:daemonology_summon | self |
| spell:vates_premonition | Presagio | 2 | effect:vates_premonition (+20 1rnd) | self |
| spell:vates_perfect_timing | Perfect Timing | 2 | effect:vates_perfect_timing | self |
| spell:vates_precognition | Precognition | 4 | effect:vates_precognition | self |
| spell:vates_misfortune | Misfortune | 4 | effect:vates_misfortune | single |
| spell:vates_weave_of_fate | Trama del Fato | 10 | effect:vates_weave_of_fate | self |
| spell:vates_vision | Visione | 0 | effect:vates_vision | self |
| spell:corpus_mend | Cura Ferite | 2 | effect:corpus_mend | single |
| spell:regeneration | Rigenerazione | 2 | effect:corpus_mend | self |
| spell:corpus_steel_body | Corpo d'Acciaio | 2 | effect:corpus_steel_body | self |
| spell:corpus_warp_speed | Warp Speed | 2 | effect:corpus_warp_speed | self |
| spell:corpus_purity_of_body | Purità del Corpo | 8 | effect:corpus_purity_of_body | radius |
| spell:corpus_haemorrhage | Emorragia | 4 | effect:corpus_haemorrhage | single |
| spell:corpus_beast_form | Forma Bestiale | 8 | effect:corpus_beast_form | self |
| spell:corpus_song_of_giant | Canto del Gigante | 8 | effect:corpus_song_of_giant | self |
| spell:kinesis_flight | Volo | 3 | effect:kinesis_flight | self |
| spell:kinesis_unlock | Sblocco | 0 | effect:kinesis_force_push (reuse) | single |
| spell:mentis_read_surface | Lettura Superficiale | 0 | effect:mentis_disrupt (reuse) | single |
| spell:pyra_ignite | Accensione | 1 | effect:pyra_flame_control_touch (reuse) | single |

**Total: 51 spells.** Unique effect definitions used: 44 (some effects shared across spells).
