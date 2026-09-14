import { runAccountingEvals, summarizeAccountingEvals } from "./index";

const results = runAccountingEvals();
const report = { summary: summarizeAccountingEvals(results), results };
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) throw new Error(`${report.summary.failed} accounting evaluation fixture(s) failed.`);
