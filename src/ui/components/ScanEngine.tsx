import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { EDGE_ENGINE_HTML } from '@/services/scanner/edgeEngineHtml';
import { Quad } from '@/services/scanner/quad';

export interface DetectResult {
  /** Detected document corners (normalised), or null when no document was found. */
  corners: Quad | null;
  width: number;
  height: number;
}

export interface ScanEngineApi {
  detect(uri: string): Promise<DetectResult>;
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
    <T,>(op: 'detect' | 'warp', uri: string, extra: Record<string, unknown> = {}): Promise<T> => {
      const task = async (): Promise<T> => {
        await readyRef.current.promise;
        const readB64 = () => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const b64 = loadedKeyRef.current === uri ? undefined : await readB64();
        try {
          const result = await call<T>({ op, key: uri, b64, ...extra });
          loadedKeyRef.current = uri;
          return result;
        } catch (e: any) {
          if (e?.message !== 'NO_IMAGE') throw e;
          const result = await call<T>({ op, key: uri, b64: await readB64(), ...extra });
          loadedKeyRef.current = uri;
          return result;
        }
      };
      const p = queueRef.current.then(task, task);
      queueRef.current = p.catch(() => undefined);
      return p;
    },
    [call]
  );

  const api = useMemo<ScanEngineApi>(
    () => ({
      detect: (uri) => run<DetectResult>('detect', uri),
      warp: async (uri, corners) => {
        const res = await run<{ b64: string }>('warp', uri, { corners });
        const dir = FileSystem.cacheDirectory;
        if (!dir) throw new Error('Cache directory is not accessible');
        const out = `${dir}scan_crop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        await FileSystem.writeAsStringAsync(out, res.b64, { encoding: FileSystem.EncodingType.Base64 });
        return out;
      },
    }),
    [run]
  );

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
