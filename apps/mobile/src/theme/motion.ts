/**
 * Motion tokens (steadily-ui "Motion"). Press feedback is quick and small so it reads as a
 * response, never a bounce. With Reduce Motion, components keep the opacity change and drop scale.
 */
export const motion = {
  /** Press-in feedback, fast enough to land within ~100 ms of the touch. */
  pressInMs: 80,
  /** Release, a touch slower so the surface settles rather than snaps. */
  pressOutMs: 160,
  /** Opacity of a surface while pressed. */
  pressedOpacity: 0.72,
  /** Scale of a card or button while pressed (not applied with Reduce Motion). */
  pressedScale: 0.98,
  /** Loading placeholder pulse, one way. */
  pulseMs: 900,
} as const;
