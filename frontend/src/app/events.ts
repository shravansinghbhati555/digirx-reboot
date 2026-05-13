/**
 * Lightweight cross-screen pub-sub on top of CustomEvent. Used when an
 * action in one screen invalidates the state another screen is showing —
 * e.g. saving a doctor availability override moves appointments, so the
 * Appointments screen + booking slot picker should refetch.
 *
 * We deliberately don't put this in AppContext: most screens never care
 * about these signals, and forcing them through a context would re-render
 * every consumer on every emit. window events are routed only to active
 * listeners and have a near-zero footprint.
 */

export const AVAILABILITY_CHANGED_EVENT = 'digirx:availability-changed';

/**
 * Tell any open screen that the doctor's rules / overrides changed.
 * Receivers should refetch whatever derived data they show (day slots,
 * appointment list, schedule preview).
 */
export function emitAvailabilityChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AVAILABILITY_CHANGED_EVENT));
}
