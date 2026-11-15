import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Folder } from '@/core/types';
import { useThemeColors } from '@/core/theme/colors';

interface FolderTabsProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onAddFolder: () => void;
  onLongPressFolder?: (folder: Folder) => void;
  allLabel: string;
}

export const FolderTabs: React.FC<FolderTabsProps> = ({
  folders,
  activeFolderId,
  onSelectFolder,
  onAddFolder,
  onLongPressFolder,
  allLabel,
}) => {
  const colors = useThemeColors();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TouchableOpacity
          style={[
            styles.chip,
            activeFolderId === null
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onPress={() => onSelectFolder(null)}
        >
          <Ionicons
            name="documents-outline"
            size={16}
            color={activeFolderId === null ? '#FFFFFF' : colors.textSecondary}
            style={styles.chipIcon}
          />
          <Text
            style={[
              styles.chipText,
              { color: activeFolderId === null ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            {allLabel}
          </Text>
        </TouchableOpacity>

        {folders.map((folder) => {
          const isActive = activeFolderId === folder.id;
          return (
            <TouchableOpacity
              key={folder.id}
              style={[
                styles.chip,
                isActive
                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={() => onSelectFolder(folder.id)}
              onLongPress={() => onLongPressFolder && onLongPressFolder(folder)}
            >
              <Ionicons
                name="folder-outline"
                size={16}
                color={isActive ? '#FFFFFF' : colors.textSecondary}
                style={styles.chipIcon}
              />
              <Text
                style={[
                  styles.chipText,
                  { color: isActive ? '#FFFFFF' : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {folder.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.addChip, { backgroundColor: colors.surface, borderColor: colors.primary }]}
          onPress={onAddFolder}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  scrollContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
