import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, last-wins on conflicting Tailwind utilities.
 *
 * `clsx` flattens the conditionals; `twMerge` is what makes a caller's `px-6` actually
 * beat a component's own `px-4` instead of both landing in the class list and letting
 * stylesheet order decide. Every component in ui/ takes a `className` and ends with this,
 * so a screen can adjust a primitive without a variant being added for it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
