import { runAdminStoreContract } from './admin-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runAdminStoreContract('memory', async () => new MemoryBookingStore(demoData()));
