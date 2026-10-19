package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.NotificationSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** JS acknowledges records by the id inside the JSON; it must be the id the file is stored under. */
class PendingStoreIdTest {
  @Test
  fun engineRecordsCarryTheirStorageId() {
    val r = TestRepo.engine().capture(
      NotificationSnapshot(
        "com.chase.sig.android",
        "Chase",
        "You made a \$5.00 transaction with BLUE BOTTLE COFFEE",
        1_760_454_720_000L,
      ),
    )!!
    assertEquals(r.id, PendingStore.idOf(r.json))
  }

  @Test
  fun unreadableRecordsHaveNoId() {
    assertNull(PendingStore.idOf("{not json"))
    assertNull(PendingStore.idOf("{\"v\":1}"))
  }
}
