import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Document } from '@/core/types';
import { useThemeColors } from '@/core/theme/colors';

interface DocumentCardProps {
  document: Document;
  variant?: 'list' | 'grid';
  onPress: () => void;
  onMore: () => void;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ document, variant = 'list', onPress, onMore }) => {
  const colors = useThemeColors();

  const thumb = document.thumbnail_path ? (
    <Image source={{ uri: document.thumbnail_path }} style={styles.thumbImg} resizeMode="cover" />
  ) : (
    <View style={styles.thumbPlaceholder}>
      <Ionicons name="document-text-outline" size={28} color={colors.textMuted} />
    </View>
  );

  if (variant === 'grid') {
    return (
      <TouchableOpacity activeOpacity={0.75} style={styles.gridCard} onPress={onPress} onLongPress={onMore}>
        <View style={[styles.gridThumb, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
          {thumb}
          <View style={styles.pageBadge}>
            <Ionicons name="documents" size={10} color="#FFFFFF" />
            <Text style={styles.pageBadgeText}>{document.page_count}</Text>
          </View>
        </View>
        <View style={styles.gridInfo}>
          <Text style={[styles.gridTitle, { color: colors.text }]} numberOfLines={1}>
            {document.title}
          </Text>
          <TouchableOpacity onPress={onMore} hitSlop={10} accessibilityLabel="More">
            <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.gridDate, { color: colors.textSecondary }]} numberOfLines={1}>
          {formatDate(document.updated_at || document.created_at)}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.row, { backgroundColor: colors.surface }]}
      onPress={onPress}
      onLongPress={onMore}
    >
      <View style={[styles.listThumb, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
        {thumb}
      </View>
      <View style={styles.listInfo}>
        <Text style={[styles.listTitle, { color: colors.text }]} numberOfLines={1}>
          {document.title}
        </Text>
        <Text style={[styles.listDate, { color: colors.textSecondary }]}>
          {formatDate(document.updated_at || document.created_at)}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.metaChip, { backgroundColor: colors.surfaceVariant }]}>
            <Ionicons name="documents-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{document.page_count}</Text>
          </View>
          {document.pdf_path ? (
            <View style={[styles.metaChip, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.metaText, { color: colors.primary }]}>PDF</Text>
            </View>
          ) : null}
        </View>
      </View>
      <TouchableOpacity style={styles.moreBtn} onPress={onMore} hitSlop={8} accessibilityLabel="More">
        <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // List variant
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  listThumb: {
    width: 58,
    height: 76,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  listInfo: {
    flex: 1,
    gap: 4,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  listDate: {
    fontSize: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  moreBtn: {
    padding: 6,
  },
  // Grid variant
  gridCard: {
    maxWidth: '31%',
    flex: 1,
    margin: 6,
  },
  gridThumb: {
    aspectRatio: 3 / 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pageBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  pageBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  gridInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  gridTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  gridDate: {
    fontSize: 11,
    marginTop: 2,
  },
});
