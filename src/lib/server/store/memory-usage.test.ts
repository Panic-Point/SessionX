import { runUsageStoreContract } from './usage-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runUsageStoreContract('memory', async () => new MemoryBookingStore(demoData()));
