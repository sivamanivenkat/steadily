package expo.modules.steadilycapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DebouncerTest {
  @Test
  fun aBurstFiresOnceAfterItGoesQuiet() {
    val d = Debouncer(quietMs = 1_000, maxWaitMs = 10_000)
    assertEquals(1_000L, d.poke(0))
    assertEquals(1_300L, d.poke(300))
    assertEquals(1_900L, d.poke(900))
    assertFalse(d.fireIfDue(1_000)) // stale check from the first poke
    assertFalse(d.fireIfDue(1_899))
    assertTrue(d.fireIfDue(1_900))
    assertFalse(d.fireIfDue(1_901)) // only once per burst
    assertNull(d.pendingAt())
  }

  @Test
  fun aSteadyStreamStillFiresAtTheCeiling() {
    val d = Debouncer(quietMs = 1_000, maxWaitMs = 3_000)
    var due = 0L
    for (t in 0L..5_000L step 500L) {
      due = d.poke(t)
      if (t >= 2_000L) assertEquals(3_000L, due)
      if (t >= 3_000L) break
    }
    assertTrue(d.fireIfDue(due))
    // The next poke starts a new burst with its own ceiling.
    assertEquals(4_500L, d.poke(3_500))
  }

  @Test
  fun separateBurstsFireSeparately() {
    val d = Debouncer(quietMs = 1_000, maxWaitMs = 10_000)
    d.poke(0)
    assertTrue(d.fireIfDue(1_000))
    d.poke(5_000)
    assertEquals(6_000L, d.pendingAt())
    assertTrue(d.fireIfDue(6_000))
  }

  @Test
  fun nothingFiresWithoutAPoke() {
    assertFalse(Debouncer(1_000, 10_000).fireIfDue(50_000))
  }
}
