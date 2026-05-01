/**
 * Aspects of Verun — Claude API client.
 * Calls the Anthropic API directly from the browser to generate AI-format item JSON.
 * Requires the anthropic-dangerous-direct-browser-access header (fine for local/home use).
 */

const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a Foundry VTT D&D 5e homebrew item generator for the Aspects of Verun campaign.
Output ONLY raw JSON — no markdown fences, no explanation, no commentary.
Return a single JSON object for one item, or a JSON array for multiple items.

SCHEMA (omit optional fields rather than setting null, unless noted):
{
  "_aiFormat": true,
  "name": "string",
  "itemCategory": "weapon|equipment|consumable|loot|tool|container|feature",
  "baseWeapon": "dagger|quarterstaff|handaxe|shortbow|longbow|longsword|shortsword|rapier|greatsword|hand crossbow|light crossbow|heavy crossbow",
  "consumableType": "potion|scroll|wand|rod|trinket|ammo|food|poison",
  "rarity": "common|uncommon|rare|very rare|legendary",
  "attunement": "required",
  "description": "<p>Flavourful HTML. 1-2 sentences.</p>",
  "magicalBonus": 1,
  "spellAttackBonus": 1,
  "imageHints": ["keyword1", "keyword2"],
  "charges": { "max": 3, "recovery": { "period": "lr", "formula": "" } },
  "activities": []
}

ACTIVITY SCHEMAS:
attack:  { "name":"string", "type":"attack", "attackType":"melee weapon|ranged weapon|melee spell|ranged spell", "damage":"1d8", "damageType":"fire", "range":5, "chargesCost":0 }
save:    { "name":"string", "type":"save", "saveAbility":"str|dex|con|int|wis|cha", "saveDC":14, "damage":"2d6", "damageType":"fire", "onSave":"half|none", "chargesCost":0 }
heal:    { "name":"string", "type":"heal", "healDice":"2d4", "healBonus":"2", "chargesCost":1 }
utility: { "name":"string", "type":"utility", "chargesCost":0 }
cast:    { "name":"string", "type":"cast", "spellName":"Fireball", "chargesCost":1 }

DAMAGE TYPES: force|necrotic|lightning|cold|fire|radiant|thunder|poison|acid|psychic|bludgeoning|piercing|slashing
RECOVERY PERIODS: sr (short rest)|lr (long rest)|day

RULES:
- weapons: always include at least one attack activity; first "melee weapon" or "ranged weapon" activity defines the base damage die and type
- consumables: include charges (max≥1) and at least one activity
- features: itemCategory "feature", typically utility activity, no charges unless it recharges
- rarity guides power: common=minor, uncommon=useful, rare=significant, very rare=powerful, legendary=exceptional
- omit "attunement" entirely if not required; omit "baseWeapon" for non-weapons; omit "consumableType" for non-consumables
- omit "charges" entirely if the item has unlimited uses
- omit "magicalBonus" and "spellAttackBonus" if zero
- imageHints: 2-4 keywords ordered most-specific-first (object type, then material/theme), e.g. ["dagger","void","dark"] not ["dark","magic","cool"]
- saveDC: use a number for a fixed DC, omit the field to use the holder's spell save DC`;

/**
 * Call the Anthropic API to generate one or more AI-format items.
 *
 * @param {string} prompt   User description of the item(s) to generate
 * @param {string} apiKey   Anthropic API key
 * @param {string} model    Model ID
 * @returns {Promise<string>}  Raw JSON string (no markdown fences)
 */
export async function generateItems(prompt, apiKey, model) {
  if (!apiKey?.trim()) {
    throw new Error("No Claude API key configured — add it in Module Settings → Aspects of Verun → Claude API Key.");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  // Strip markdown code fences if the model added them despite instructions
  return text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
}
