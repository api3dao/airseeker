export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isFulfilled<T>(item: PromiseSettledResult<T>): item is PromiseFulfilledResult<T> {
  return item.status === 'fulfilled';
}
