import { runRepertoireStoreContract } from './repertoire-contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runRepertoireStoreContract('memory', async () => new MemoryBookingStore(demoData()));
