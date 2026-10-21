// Add to list from any poster's circle: the sheet listens here (AddToList.tsx), and the Lists page hears a change
export const listsBus = new EventTarget();
export type AddTo = { key: string; title: string; from: HTMLElement | null };
export const openAddTo = (a: AddTo) => listsBus.dispatchEvent(new CustomEvent('open', { detail: a }));
export const listsChanged = () => listsBus.dispatchEvent(new Event('changed'));
