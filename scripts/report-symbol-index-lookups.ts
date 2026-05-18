import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { buildSymbolIndexLookupReport } from '@goose-hub/core/symbol-index/report.js';

const events = eventStore.replay({ kind: 'symbol-index.lookup' });
const report = buildSymbolIndexLookupReport(events);

console.log(JSON.stringify(report, null, 2));
