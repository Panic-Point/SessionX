import { runSeriesStoreContract } from './series-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runSeriesStoreContract('memory', async () => new MemoryBookingStore(demoData()));
