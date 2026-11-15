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
import { lightColors } from '@/core/theme/colors';

interface FolderTabsProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onAddFolder: () => void;
  allLabel: string;
}

export const FolderTabs: React.FC<FolderTabsProps> = ({
  folders,
  activeFolderId,
  onSelectFolder,
  onAddFolder,
  allLabel,
}) => {
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
            activeFolderId === null ? styles.activeChip : styles.inactiveChip,
          ]}
          onPress={() => onSelectFolder(null)}
        >
          <Ionicons
            name="documents-outline"
            size={16}
            color={activeFolderId === null ? '#FFFFFF' : lightColors.textSecondary}
            style={styles.chipIcon}
          />
          <Text
            style={[
              styles.chipText,
              activeFolderId === null ? styles.activeChipText : styles.inactiveChipText,
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
              style={[styles.chip, isActive ? styles.activeChip : styles.inactiveChip]}
              onPress={() => onSelectFolder(folder.id)}
            >
              <Ionicons
                name="folder-outline"
                size={16}
                color={isActive ? '#FFFFFF' : lightColors.textSecondary}
                style={styles.chipIcon}
              />
              <Text
                style={[
                  styles.chipText,
                  isActive ? styles.activeChipText : styles.inactiveChipText,
                ]}
                numberOfLines={1}
              >
                {folder.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.addChip} onPress={onAddFolder}>
          <Ionicons name="add" size={18} color={lightColors.primary} />
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
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeChip: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  inactiveChip: {
    backgroundColor: '#FFFFFF',
    borderColor: lightColors.border,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  activeChipText: {
    color: '#FFFFFF',
  },
  inactiveChipText: {
    color: lightColors.text,
  },
  addChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: lightColors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
