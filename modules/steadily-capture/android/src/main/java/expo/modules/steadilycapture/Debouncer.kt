package expo.modules.steadilycapture

/**
 * Trailing-edge debounce with a ceiling, as pure logic so it can be unit tested.
 *
 * A burst of [poke] calls produces one firing [quietMs] after the last poke, but never later than
 * [maxWaitMs] after the first poke of the burst (so a steady stream still drains). The caller owns
 * the timer: schedule a check at the time [poke] returns, and call [fireIfDue] when it runs.
 */
class Debouncer(private val quietMs: Long, private val maxWaitMs: Long) {
  private var burstStart: Long? = null
  private var due: Long? = null

  /** Records an event at [now]. Returns when the action should run. */
  @Synchronized
  fun poke(now: Long): Long {
    val start = burstStart ?: now.also { burstStart = it }
    val next = minOf(now + quietMs, start + maxWaitMs)
    due = next
    return next
  }

  /**
   * Called when a scheduled check runs. Returns true exactly once per burst, when its time has
   * come; the caller then runs the action. Returns false for early or stale checks.
   */
  @Synchronized
  fun fireIfDue(now: Long): Boolean {
    val d = due ?: return false
    if (now < d) return false
    due = null
    burstStart = null
    return true
  }

  /** The time the pending firing is due, or null if nothing is pending. */
  @Synchronized
  fun pendingAt(): Long? = due
}
