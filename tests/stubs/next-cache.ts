/*
   Cache invalidation has no meaning without a running Next server. The
   actions under test call these after a successful mutation; the mutation
   itself is what the tests look at.
*/
export function revalidatePath(_path: string, _type?: string): void {}
export function revalidateTag(_tag: string): void {}
export function unstable_noStore(): void {}
