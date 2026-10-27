import { runPasswordStoreContract } from './password-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runPasswordStoreContract('memory', async () => new MemoryBookingStore(demoData()));
