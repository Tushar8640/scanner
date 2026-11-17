import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { EDGE_ENGINE_HTML } from '@/services/scanner/edgeEngineHtml';
import { Quad } from '@/services/scanner/quad';
import type { PageAdjust, PageFilter } from '@/core/types';

export interface DetectResult {
  /** Detected document corners (normalised), or null when no document was found. */
  corners: Quad | null;
  width: number;
  height: number;
}

export interface PrepareResult extends DetectResult {
  /** Orientation-fixed, size-capped copy of the input. Use this as the page source from now on. */
  uri: string;
}

export interface ScanEngineApi {
  detect(uri: string): Promise<DetectResult>;
  /**
   * Normalises a new capture (applies EXIF rotation, caps size) and detects its edges in one pass.
   * React Native and the engine then see exactly the same pixels, so crop handles line up.
   */
  prepare(uri: string): Promise<PrepareResult>;
  /** Places one or two images (ID card front / back) on a white A4 page. Returns a file URI. */
  composeIdCard(uris: string[]): Promise<string>;
  /** Bakes the filter, adjustments and rotation into a JPEG (saving, sharing, PDF). Returns a file URI. */
  renderFiltered(uri: string, filter: PageFilter, adjust: PageAdjust | null | undefined, rotation: number): Promise<string>;
  /** Perspective-corrects the image to the given corners and returns a new file URI. */
  warp(uri: string, corners: Quad): Promise<string>;
}

const ScanEngineContext = createContext<ScanEngineApi | null>(null);

export function useScanEngine(): ScanEngineApi {
  const ctx = useContext(ScanEngineContext);
  if (!ctx) throw new Error('useScanEngine must be used inside <ScanEngineProvider>');
  return ctx;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CALL_TIMEOUT_MS = 60000;

/**
 * Hosts the hidden WebView that runs edge detection and perspective correction.
 * Calls are serialised, and the last decoded image is cached inside the WebView
 * so detect + warp on the same page only transfers the image once.
 */
export function ScanEngineProvider({ children }: { children: React.ReactNode }) {
  // Typed as any to match DocumentPageView: WebView's class typings conflict with React 19 ref types
  const webRef = useRef<any>(null);
  const readyRef = useRef<Deferred<void>>(deferred<void>());
  const pendingRef = useRef(new Map<number, Deferred<any>>());
  const nextIdRef = useRef(1);
  const loadedKeyRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const resetEngine = useCallback((reason: string) => {
    loadedKeyRef.current = null;
    pendingRef.current.forEach((d) => d.reject(new Error(reason)));
    pendingRef.current.clear();
    readyRef.current = deferred<void>();
    webRef.current?.reload();
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg?.type === 'ready') {
      loadedKeyRef.current = null;
      readyRef.current.resolve();
      return;
    }
    const d = pendingRef.current.get(msg?.id);
    if (!d) return;
    pendingRef.current.delete(msg.id);
    if (msg.ok) d.resolve(msg.result);
    else d.reject(new Error(msg.error || 'Scan engine error'));
  }, []);

  const call = useCallback(<T,>(req: Record<string, unknown>): Promise<T> => {
    const id = nextIdRef.current++;
    const d = deferred<T>();
    pendingRef.current.set(id, d);
    const timer = setTimeout(() => {
      if (pendingRef.current.delete(id)) d.reject(new Error('Scan engine timed out'));
    }, CALL_TIMEOUT_MS);
    webRef.current?.injectJavaScript(`window.__scan && window.__scan(${JSON.stringify({ ...req, id })}); true;`);
    return d.promise.finally(() => clearTimeout(timer));
  }, []);

  const run = useCallback(
    <T,>(
      op: 'detect' | 'warp' | 'prepare' | 'render',
      uri: string,
      extra: Record<string, unknown> = {},
      /** Key the engine caches the image under afterwards (prepare re-keys to its output file). */
      cachedAs: string = uri
    ): Promise<T> => {
      const task = async (): Promise<T> => {
        await readyRef.current.promise;
        const readB64 = () => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const b64 = loadedKeyRef.current === uri ? undefined : await readB64();
        try {
          const result = await call<T>({ op, key: uri, b64, ...extra });
          loadedKeyRef.current = cachedAs;
          return result;
        } catch (e: any) {
          if (e?.message !== 'NO_IMAGE') throw e;
          const result = await call<T>({ op, key: uri, b64: await readB64(), ...extra });
          loadedKeyRef.current = cachedAs;
          return result;
        }
      };
      const p = queueRef.current.then(task, task);
      queueRef.current = p.catch(() => undefined);
      return p;
    },
    [call]
  );

  const api = useMemo<ScanEngineApi>(() => {
    const newCacheFile = (prefix: string) => {
      const dir = FileSystem.cacheDirectory;
      if (!dir) throw new Error('Cache directory is not accessible');
      return `${dir}${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    };
    return {
      detect: (uri) => run<DetectResult>('detect', uri),
      prepare: async (uri) => {
        const out = newCacheFile('scan_src');
        const res = await run<DetectResult & { b64: string }>('prepare', uri, { alias: out }, out);
        await FileSystem.writeAsStringAsync(out, res.b64, { encoding: FileSystem.EncodingType.Base64 });
        return { uri: out, corners: res.corners, width: res.width, height: res.height };
      },
      composeIdCard: async (uris) => {
        const task = async () => {
          await readyRef.current.promise;
          const images = await Promise.all(
            uris.map((u) => FileSystem.readAsStringAsync(u, { encoding: FileSystem.EncodingType.Base64 }))
          );
          return call<{ b64: string }>({ op: 'compose', images });
        };
        const p = queueRef.current.then(task, task);
        queueRef.current = p.catch(() => undefined);
        const res = await p;
        const out = newCacheFile('id_card');
        await FileSystem.writeAsStringAsync(out, res.b64, { encoding: FileSystem.EncodingType.Base64 });
        return out;
      },
      renderFiltered: async (uri, filter, adjust, rotation) => {
        const res = await run<{ b64: string }>('render', uri, { filter, adjust: adjust ?? null, rotation });
        const out = newCacheFile('scan_page');
        await FileSystem.writeAsStringAsync(out, res.b64, { encoding: FileSystem.EncodingType.Base64 });
        return out;
      },
      warp: async (uri, corners) => {
        const res = await run<{ b64: string }>('warp', uri, { corners });
        const out = newCacheFile('scan_crop');
        await FileSystem.writeAsStringAsync(out, res.b64, { encoding: FileSystem.EncodingType.Base64 });
        return out;
      },
    };
  }, [run, call]);

  return (
    <ScanEngineContext.Provider value={api}>
      {children}
      <View pointerEvents="none" style={styles.hidden}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html: EDGE_ENGINE_HTML }}
          javaScriptEnabled
          onMessage={onMessage}
          onRenderProcessGone={() => resetEngine('Scan engine restarted')}
          onContentProcessDidTerminate={() => resetEngine('Scan engine restarted')}
          style={styles.hidden}
        />
      </View>
    </ScanEngineContext.Provider>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: 0,
    top: 0,
  },
});
