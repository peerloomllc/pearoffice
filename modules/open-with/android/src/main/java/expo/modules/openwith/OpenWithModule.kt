package expo.modules.openwith

import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Name and type of a file handed to PearOffice by another app. Asks the
// app that owns the content:// address; a file:// address gives its last part.
class OpenWithModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenWith")

    AsyncFunction("fileInfo") { uriString: String ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf("name" to null, "mime" to null)
      val uri = Uri.parse(uriString)
      var name: String? = null
      if (uri.scheme == "content") {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (i >= 0 && c.moveToFirst()) name = c.getString(i)
        }
      } else {
        name = uri.lastPathSegment
      }
      mapOf("name" to name, "mime" to context.contentResolver.getType(uri))
    }

    // Copies the file into the app's cache and returns its file:// address.
    // expo-file-system reads only its own and Storage Access Framework
    // addresses, not one from the Files app or a mail app. Larger than
    // maxBytes is refused without copying the rest.
    AsyncFunction("copyToCache") { uriString: String, maxBytes: Double ->
      val context = appContext.reactContext ?: throw Exception("no context")
      val dest = File(context.cacheDir, "opened-file")
      val input = context.contentResolver.openInputStream(Uri.parse(uriString)) ?: throw Exception("cannot read the file")
      input.use { inp ->
        dest.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = inp.read(buf)
            if (n < 0) break
            total += n
            if (total > maxBytes.toLong()) { out.close(); dest.delete(); throw Exception("too large") }
            out.write(buf, 0, n)
          }
        }
      }
      Uri.fromFile(dest).toString()
    }
  }
}
