import { readJson, validateDocument } from './documents.js';
import { object, diagnostic, type FormatResult } from './character.js';
import type { Character, JsonObject } from './documents.generated.js';

export interface CardConversion { document: Character; report: { sourceFormat: 'character-card-v1' | 'character-card-v2'; mapped: { from: string; to: string }[]; preserved: string[]; warnings: string[] } }
/** JSON card import only. Prompt overrides and lorebooks are retained as inert source data. */
export function importCharacterCard(source: string, id: string): FormatResult<CardConversion> {
  const parsed = readJson(source);
  if (!parsed.ok) return parsed;
  const card = parsed.value;
  if (!object(card)) return { ok: false, diagnostics: [diagnostic('structural', 'INVALID_CARD', '', 'Supply a character-card JSON object.')] };
  const v2 = card.spec === 'chara_card_v2' && card.spec_version === '2.0';
  if (Object.hasOwn(card, 'spec') && !v2) return { ok: false, diagnostics: [diagnostic('structural', 'UNSUPPORTED_CARD_VERSION', '/spec', 'Use character-card v1 or v2 JSON.')] };
  const data = v2 ? card.data : card;
  if (!object(data) || ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'].some(key => typeof data[key] !== 'string')) {
    return { ok: false, diagnostics: [diagnostic('structural', 'INVALID_CARD', '', 'Supply all six base card text fields.')] };
  }
  const prefix = v2 ? '/data' : '';
  const mapped = [{ from: `${prefix}/name`, to: '/name' }, { from: `${prefix}/description`, to: '/persona/description' }, { from: `${prefix}/personality`, to: '/persona/description' }];
  const document: Character = { specVersion: '0.2.0-draft.2', kind: 'character', id, name: data.name as string,
    persona: { description: [data.description, data.personality].filter(Boolean).join('\n\n') },
    profiles: { 'simkind.card-source': { version: '0.1.0', required: false } },
    extensions: { 'simkind.card-source': structuredClone(card) as JsonObject } };
  const valid = validateDocument(document);
  if (!valid.ok) return valid;
  return { ok: true, value: { document, report: { sourceFormat: v2 ? 'character-card-v2' : 'character-card-v1', mapped,
    preserved: Object.keys(data).filter(key => !['name', 'description', 'personality'].includes(key)).map(key => `${prefix}/${key}`),
    warnings: ['Original JSON data is preserved in the optional simkind.card-source extension.',
      'Scenario, greetings, sample dialogue, lorebooks, and prompt overrides are inert. Review and author a Simkind scenario separately.',
      'No tools, permissions, model assignments, or host capabilities were imported. PNG metadata extraction is not supported.'] } } };
}
