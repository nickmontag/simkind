import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readDocument, type ActionEvent, type ActionProposal, type Clock } from '../src/format/index.js';
import { ActionLedger } from '../src/runner/index.js';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const cases = JSON.parse(read('../fixtures/format/draft.2/cases.json')) as { id: string; input: string; expectedKind: string }[];
const schema = JSON.parse(read('../schemas/0.2.0-draft.2/document.schema.json'));
const ajv = new Ajv2020({ strict: true }).addSchema(schema, 'document.schema.json');
describe('language-neutral M1 fixtures', () => {
  for (const fixture of cases) it(fixture.id, () => {
    const source = read('../fixtures/format/draft.2/' + fixture.input);
    expect(readDocument(source)).toMatchObject({ ok: true, value: { kind: fixture.expectedKind } });
    const wrapper = JSON.parse(read('../schemas/0.2.0-draft.2/' + fixture.expectedKind + '.schema.json'));
    expect(ajv.compile(wrapper)(JSON.parse(source))).toBe(true);
  });
  it('H06 replays the recorded lifecycle without executing a tool', () => {
    const fixture = JSON.parse(read('../fixtures/host/uncertain-action.json')) as { clocks: Clock[]; proposal: ActionProposal; events: ActionEvent[]; expectedStatuses: string[] };
    const ledger = new ActionLedger(fixture.proposal.runId, fixture.clocks);
    ledger.propose(fixture.proposal);
    const statuses = fixture.events.map(event => { ledger.receive([event]); return ledger.get(fixture.proposal.id)!.status; });
    expect(statuses).toEqual(fixture.expectedStatuses);
    expect(ledger.unresolved()).toEqual([]);
  });
});
