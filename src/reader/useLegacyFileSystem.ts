import { useCallback, useState } from 'react';
import * as ExpoFileSystem from 'expo-file-system/legacy';
import type { FileSystem as ReaderFileSystem } from '@epubjs-react-native/expo-file-system';

export function useLegacyFileSystem(): ReaderFileSystem {
  const [file, setFile] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const downloadFile = useCallback(async (fromUrl: string, toFile: string) => {
    if (!ExpoFileSystem.documentDirectory) {
      setError('Document directory is unavailable');
      return { uri: null, mimeType: null };
    }

    const downloadResumable = ExpoFileSystem.createDownloadResumable(
      fromUrl,
      `${ExpoFileSystem.documentDirectory}${toFile}`,
      { cache: true },
      (downloadProgress) => {
        const expectedBytes = downloadProgress.totalBytesExpectedToWrite;
        if (expectedBytes <= 0) return;

        setProgress(Math.round((downloadProgress.totalBytesWritten / expectedBytes) * 100));
      }
    );

    setDownloading(true);

    try {
      const value = await downloadResumable.downloadAsync();
      if (!value) throw new Error('Download failed');

      const contentLength = value.headers['Content-Length'] ?? value.headers['content-length'];
      if (contentLength) setSize(Number(contentLength));

      setSuccess(true);
      setError(null);
      setFile(value.uri);

      return { uri: value.uri, mimeType: value.mimeType };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error downloading file');
      return { uri: null, mimeType: null };
    } finally {
      setDownloading(false);
    }
  }, []);

  const getFileInfo = useCallback(async (fileUri: string) => {
    const fileInfo = await ExpoFileSystem.getInfoAsync(fileUri);

    return {
      uri: fileInfo.uri,
      exists: fileInfo.exists,
      isDirectory: fileInfo.isDirectory,
      size: fileInfo.exists ? fileInfo.size : undefined,
    };
  }, []);

  return {
    file,
    progress,
    downloading,
    size,
    error,
    success,
    documentDirectory: ExpoFileSystem.documentDirectory,
    cacheDirectory: ExpoFileSystem.cacheDirectory,
    bundleDirectory: ExpoFileSystem.bundleDirectory ?? undefined,
    readAsStringAsync: ExpoFileSystem.readAsStringAsync,
    writeAsStringAsync: ExpoFileSystem.writeAsStringAsync,
    deleteAsync: ExpoFileSystem.deleteAsync,
    downloadFile,
    getFileInfo,
  };
}
