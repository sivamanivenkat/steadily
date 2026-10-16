package expo.modules.steadilycapture

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypted staging inbox for fast-path captures.
 *
 * Each record is one small JSON document with extracted fields only (never alert text),
 * sealed with AES-256-GCM under a key that lives in the Android Keystore and never leaves it.
 * The record id is bound to the ciphertext as associated data, so files cannot be swapped.
 *
 * Why not write to the app's SQLCipher database directly: its key is owned by expo-secure-store
 * on the JS side, and the SQLCipher engine is private to expo-sqlite. The JS layer drains this
 * store into the real inbox (see `peekPending` / `acknowledgePending` in src/index.ts).
 */
class PendingStore(context: Context) {
  private val dir = File(context.filesDir, DIR_NAME).apply { mkdirs() }

  fun count(): Int = files().size

  /** Seals and stores one record. Drops the oldest records beyond [MAX_RECORDS]. */
  fun put(id: String, json: String) {
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    val sealed = cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
    val target = File(dir, "$id$EXT")
    val temp = File(dir, "$id.tmp")
    temp.writeBytes(sealed)
    if (!temp.renameTo(target)) {
      temp.delete()
      throw java.io.IOException("could not store record")
    }
    trim()
  }

  /** Oldest first. Records that cannot be decrypted are deleted: they can never be read. */
  fun peek(limit: Int): List<Record> {
    val out = ArrayList<Record>()
    for (file in files()) {
      if (out.size >= limit) break
      val id = file.name.removeSuffix(EXT)
      val json = open(id, file)
      if (json == null) file.delete() else out.add(Record(id, json))
    }
    return out
  }

  /** Deletes records by id. Returns how many existed. */
  fun ack(ids: List<String>): Int {
    var removed = 0
    for (id in ids) {
      if (!ID_PATTERN.matches(id)) continue
      if (File(dir, "$id$EXT").delete()) removed++
    }
    return removed
  }

  data class Record(val id: String, val json: String)

  private fun files(): List<File> =
    (dir.listFiles { f -> f.name.endsWith(EXT) } ?: emptyArray()).sortedBy { it.lastModified() }

  private fun trim() {
    val all = files()
    if (all.size > MAX_RECORDS) all.take(all.size - MAX_RECORDS).forEach { it.delete() }
  }

  private fun open(id: String, file: File): String? =
    try {
      val bytes = file.readBytes()
      if (bytes.size <= IV_BYTES) {
        null
      } else {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
          Cipher.DECRYPT_MODE,
          key(),
          GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES),
        )
        cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
        String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
      }
    } catch (_: Exception) {
      null
    }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    const val DIR_NAME = "steadily-capture-pending"
    const val MAX_RECORDS = 500
    private const val EXT = ".rec"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "steadily.capture.pending.v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private val ID_PATTERN = Regex("^[0-9a-fA-F-]{36}$")

    fun newId(): String = UUID.randomUUID().toString()
  }
}
