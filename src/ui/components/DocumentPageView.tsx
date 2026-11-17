import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { PageAdjust, PageFilter } from '@/core/types';
import { generatePageHtml } from '@/services/image/FilterUtils';

interface DocumentPageViewProps {
  uri: string;
  filter: PageFilter;
  adjust?: PageAdjust | null;
  rotation?: number;
  style?: ViewStyle;
  backgroundColor?: string;
  /** Longest side the page is processed at. Use a small value for grid cells. */
  maxSide?: number;
  /** When set, small previews of these filters are rendered from this page and passed to onThumbnails. */
  thumbFilters?: PageFilter[];
  onThumbnails?: (items: Partial<Record<PageFilter, string>>) => void;
}

/** Renders one page with its filter, adjustments and rotation (pixel pipeline in a WebView). */
export const DocumentPageView: React.FC<DocumentPageViewProps> = ({
  uri,
  filter,
  adjust = null,
  rotation = 0,
  style,
  backgroundColor = '#1E1E1E',
  maxSide = 1600,
  thumbFilters,
  onThumbnails,
}) => {
  // Image data plus the filter state at load time; the HTML is built from this once per image
  const [initial, setInitial] = useState<{ base64: string; filter: PageFilter; adjust: PageAdjust | null; rotation: number } | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(true);
  const webViewRef = useRef<any>(null);
  const isWebViewLoadedRef = useRef<boolean>(false);
  // Latest filter state, read when the image finishes loading and when the WebView is ready
  const latestRef = useRef({ filter, adjust, rotation });
  const onThumbsRef = useRef(onThumbnails);
  useEffect(() => {
    onThumbsRef.current = onThumbnails;
  }, [onThumbnails]);
  const thumbKey = thumbFilters?.join(',') ?? '';

  useEffect(() => {
    let isMounted = true;
    async function loadImage() {
      try {
        setLoading(true);
        isWebViewLoadedRef.current = false;
        const data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (isMounted) {
          setInitial({ base64: data, ...latestRef.current });
          setLoading(false);
        }
      } catch (err) {
        console.warn('Failed to load image for preview:', err);
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadImage();
    return () => {
      isMounted = false;
    };
  }, [uri]);

  const adjustKey = adjust ? `${adjust.contrast},${adjust.brightness},${adjust.details}` : '';

  // Live update without reloading the page
  useEffect(() => {
    latestRef.current = { filter, adjust, rotation };
    if (isWebViewLoadedRef.current && webViewRef.current) {
      const script = `window.applyFilter && window.applyFilter(${JSON.stringify(filter)}, ${JSON.stringify(adjust)}, ${rotation}); true;`;
      webViewRef.current.injectJavaScript(script);
    }
    // adjustKey stands in for the adjust object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, adjustKey, rotation]);

  const html = useMemo(
    () =>
      initial
        ? generatePageHtml({
            base64: initial.base64,
            filter: initial.filter,
            adjust: initial.adjust,
            rotation: initial.rotation,
            backgroundColor,
            maxSide,
            thumbFilters: thumbKey ? (thumbKey.split(',') as PageFilter[]) : [],
          })
        : '',
    [initial, backgroundColor, maxSide, thumbKey]
  );

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg?.type === 'thumbs') onThumbsRef.current?.(msg.items);
    } catch {
      // ignore
    }
  };

  if (loading || !initial) {
    return (
      <View style={[styles.center, { backgroundColor }, style]}>
        <ActivityIndicator size="large" color="#0FA58E" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html }}
        style={[styles.webview, { backgroundColor }]}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        onMessage={onMessage}
        onLoadEnd={() => {
          isWebViewLoadedRef.current = true;
          // Apply anything that changed while the page was loading
          const cur = latestRef.current;
          webViewRef.current?.injectJavaScript(
            `window.applyFilter && window.applyFilter(${JSON.stringify(cur.filter)}, ${JSON.stringify(cur.adjust)}, ${cur.rotation}); true;`
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
  },
  webview: {
    width: '100%',
    height: '100%',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
