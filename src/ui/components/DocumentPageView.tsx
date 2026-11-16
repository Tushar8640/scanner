import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { PageFilter } from '@/core/types';
import { generatePageHtml } from '@/services/image/FilterUtils';

interface DocumentPageViewProps {
  uri: string;
  filter: PageFilter;
  intensity?: number;
  rotation?: number;
  style?: ViewStyle;
  backgroundColor?: string;
}

export const DocumentPageView: React.FC<DocumentPageViewProps> = ({
  uri,
  filter,
  intensity = 0.6,
  rotation = 0,
  style,
  backgroundColor = '#1E1E1E',
}) => {
  const [base64, setBase64] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const webViewRef = useRef<any>(null);
  const isWebViewLoadedRef = useRef<boolean>(false);

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
          setBase64(data);
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

  // When filter, intensity, or rotation updates and WebView is loaded, send live GPU update without reload
  useEffect(() => {
    if (isWebViewLoadedRef.current && webViewRef.current) {
      const script = `if (window.applyFilterUpdate) { window.applyFilterUpdate('${filter}', ${intensity}, ${rotation}); }; true;`;
      webViewRef.current.injectJavaScript(script);
    }
  }, [filter, intensity, rotation]);

  if (loading || !base64) {
    return (
      <View style={[styles.center, { backgroundColor }, style]}>
        <ActivityIndicator size="large" color="#0FA58E" />
      </View>
    );
  }

  const html = generatePageHtml({
    base64,
    filter,
    intensity,
    rotation,
    backgroundColor,
    isForPdf: false,
  });

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
        onLoadEnd={() => {
          isWebViewLoadedRef.current = true;
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
