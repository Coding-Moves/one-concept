import AsyncStorage from '@react-native-async-storage/async-storage';
import { MutationOutbox, QueuedMutation } from './mutationOutbox';
export { keyOf } from './mutationOutbox';
export type { QueuedMutation } from './mutationOutbox';

// Preserve existing queues when an installed app receives the update.
const queue = new MutationOutbox(AsyncStorage, 'one-concept/mutation-queue/v1');
export const subscribeQueue = queue.subscribe;
export const enqueue = (mutation: QueuedMutation) => queue.enqueue(mutation);
export const dequeue = (key: string, expected?: QueuedMutation) => queue.dequeue(key, expected);
export const pending = () => queue.pending();
export const clearQueue = () => queue.clear();
