// The name and type of a file another app opened PearOffice with ("Open with"
// on Android). A content:// address says neither, and the import picks its
// reader by the file's extension. Android only; null elsewhere.
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

type Info = { name: string | null, mime: string | null }
const native = Platform.OS === 'android' ? requireOptionalNativeModule('OpenWith') : null

export async function fileInfo (uri: string): Promise<Info | null> {
  if (!native) return null
  try { return await native.fileInfo(uri) } catch { return null }
}

// Copies it into the app's cache; resolves to a file:// address. Throws
// "too large" past maxBytes.
export async function copyToCache (uri: string, maxBytes: number): Promise<string> {
  if (!native) throw new Error('not available')
  return native.copyToCache(uri, maxBytes)
}
