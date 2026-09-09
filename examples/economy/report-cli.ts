import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { loadRun, isArchivedRun, openArchivedRun } from 'simkind/node';
import { compareRuns } from 'simkind/runner';
import type { RunEvent } from 'simkind/format';
import { economyCsv, recordedEconomyReports, type EconomyReport } from './report.js';
const { values } = parseArgs({ options: { input: { type: 'string' }, csv: { type: 'string' } } });
if (!values.input) throw new Error('Supply --input with a saved run directory. This command only reads evidence.');
const archived = await isArchivedRun(values.input) ? await openArchivedRun(values.input) : undefined;
try {
  const legacy = archived ? undefined : await loadRun(values.input);
  let report: EconomyReport | undefined;
  function* events(): Generator<RunEvent> {
    for (let offset = 0;; offset += 128) {
      const page = archived ? archived.events(offset, 128) : legacy!.events.slice(offset, offset + 128);
      report = recordedEconomyReports(page).at(-1) ?? report;
      yield* page;
      if (page.length < 128) break;
    }
  }
  const reportedUsage = compareRuns(events(), []).left;
  if (!report) throw new Error('No unredacted market observations in this recording.');
  if (values.csv) await writeFile(values.csv, economyCsv(report), { flag: 'wx' });
  console.log(JSON.stringify({ runId: (archived ?? legacy)!.manifest.runId, completed: report.completed, day: report.day, initialCoins: report.initialCoins, conservedCoins: report.conservedCoins,
    people: report.people, trades: report.transactions.filter(t => t.kind === 'trade').length, jobs: report.transactions.filter(t => t.kind === 'wage').length, reportedUsage }, null, 2));
} finally { archived?.close(); }
