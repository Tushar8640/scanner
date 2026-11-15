import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  AlertButton,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Document } from '@/core/types';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';

interface DocumentCardProps {
  document: Document;
  onPress: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRename: () => void;
  onMoveToFolder?: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onPress,
  onShare,
  onDelete,
  onRename,
  onMoveToFolder,
}) => {
  const colors = useThemeColors();
  const { t } = useSettingsStore();

  const formatDate = (ms: number) => {
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const handleOptions = () => {
    const options: AlertButton[] = [
      { text: t('share'), onPress: onShare },
      { text: t('rename'), onPress: onRename },
    ];

    if (onMoveToFolder) {
      options.push({ text: t('moveToFolder'), onPress: onMoveToFolder });
    }

    options.push({ text: t('delete'), onPress: onDelete, style: 'destructive' as const });
    options.push({ text: t('cancel'), style: 'cancel' as const, onPress: () => {} });

    Alert.alert(document.title, t('selectOption'), options, { cancelable: true });
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
    >
      <View style={[styles.thumbnailContainer, { backgroundColor: colors.surfaceVariant }]}>
        {document.thumbnail_path ? (
          <Image
            source={{ uri: document.thumbnail_path }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderThumb}>
            <Ionicons name="document-text-outline" size={32} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{document.page_count} P</Text>
        </View>
      </View>

      <View style={styles.infoContainer}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {document.title}
        </Text>
        <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(document.created_at)}</Text>
      </View>

      <TouchableOpacity
        style={styles.moreBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        onPress={handleOptions}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  thumbnailContainer: {
    width: 60,
    height: 75,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholderThumb: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  infoContainer: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  date: {
    fontSize: 13,
  },
  moreBtn: {
    padding: 8,
  },
});
