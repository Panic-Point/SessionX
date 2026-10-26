import { runAccountStoreContract } from './account-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runAccountStoreContract('memory', async () => new MemoryBookingStore(demoData()));
