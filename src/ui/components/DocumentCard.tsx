import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Document } from '@/core/types';
import { lightColors } from '@/core/theme/colors';

interface DocumentCardProps {
  document: Document;
  onPress: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRename: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onPress,
  onShare,
  onDelete,
  onRename,
}) => {
  const formatDate = (ms: number) => {
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const handleOptions = () => {
    Alert.alert(
      document.title,
      'Select Option',
      [
        { text: 'Share', onPress: onShare },
        { text: 'Rename', onPress: onRename },
        { text: 'Delete', onPress: onDelete, style: 'destructive' },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={styles.card}
      onPress={onPress}
    >
      <View style={styles.thumbnailContainer}>
        {document.thumbnail_path ? (
          <Image
            source={{ uri: document.thumbnail_path }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderThumb}>
            <Ionicons name="document-text-outline" size={32} color={lightColors.textMuted} />
          </View>
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{document.page_count} P</Text>
        </View>
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {document.title}
        </Text>
        <Text style={styles.date}>{formatDate(document.created_at)}</Text>
      </View>

      <TouchableOpacity
        style={styles.moreBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        onPress={handleOptions}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={lightColors.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: lightColors.border,
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
    backgroundColor: lightColors.surfaceVariant,
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
    color: lightColors.text,
    marginBottom: 4,
  },
  date: {
    fontSize: 13,
    color: lightColors.textSecondary,
  },
  moreBtn: {
    padding: 8,
  },
});
