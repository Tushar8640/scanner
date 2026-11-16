import React, { useRef, useState } from 'react';
import { Animated, GestureResponderEvent, LayoutAnimation, StyleSheet, View } from 'react-native';

interface DraggableGridProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number, isDragging: boolean) => React.ReactNode;
  /** Items per row. For a single horizontal strip pass data.length. */
  columns: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  onReorder: (from: number, to: number) => void;
  onPressItem?: (index: number) => void;
  /** Lets the parent turn off scrolling while an item is being dragged. */
  onDragActiveChange?: (active: boolean) => void;
}

const LONG_PRESS_MS = 260;
const TAP_SLOP = 10;

/**
 * Grid whose items can be rearranged: long-press an item, drag it, release to drop.
 * A short tap calls onPressItem. Built on the React Native responder system, no extra libraries.
 */
export function DraggableGrid<T>({
  data,
  keyExtractor,
  renderItem,
  columns,
  cellWidth,
  cellHeight,
  gap,
  onReorder,
  onPressItem,
  onDragActiveChange,
}: DraggableGridProps<T>) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [pan] = useState(() => new Animated.ValueXY());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const activeRef = useRef<{ from: number; to: number } | null>(null);

  const cols = Math.max(1, columns);
  const rows = Math.max(1, Math.ceil(data.length / cols));
  const width = cols * cellWidth + (cols - 1) * gap;
  const height = rows * cellHeight + (rows - 1) * gap;
  const slot = (i: number) => ({ x: (i % cols) * (cellWidth + gap), y: Math.floor(i / cols) * (cellHeight + gap) });

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const endDrag = (commit: boolean) => {
    clearTimer();
    const active = activeRef.current;
    activeRef.current = null;
    if (!active) return;
    LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
    pan.setValue({ x: 0, y: 0 });
    setDrag(null);
    onDragActiveChange?.(false);
    if (commit && active.from !== active.to) onReorder(active.from, active.to);
  };

  const handlersFor = (index: number) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => activeRef.current !== null,
    // Before the long press fires, let a parent ScrollView take over (normal scrolling)
    onResponderTerminationRequest: () => activeRef.current === null,
    onResponderGrant: (e: GestureResponderEvent) => {
      startRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      movedRef.current = false;
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (movedRef.current) return;
        activeRef.current = { from: index, to: index };
        pan.setValue({ x: 0, y: 0 });
        setDrag({ from: index, to: index });
        onDragActiveChange?.(true);
      }, LONG_PRESS_MS);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - startRef.current.x;
      const dy = e.nativeEvent.pageY - startRef.current.y;
      const active = activeRef.current;
      if (!active) {
        if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) {
          movedRef.current = true;
          clearTimer();
        }
        return;
      }
      pan.setValue({ x: dx, y: dy });
      const s = slot(active.from);
      const cx = s.x + cellWidth / 2 + dx;
      const cy = s.y + cellHeight / 2 + dy;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(cx / (cellWidth + gap))));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(cy / (cellHeight + gap))));
      const to = Math.min(data.length - 1, row * cols + col);
      if (to !== active.to) {
        LayoutAnimation.configureNext(LayoutAnimation.create(140, 'easeInEaseOut', 'opacity'));
        activeRef.current = { from: active.from, to };
        setDrag({ from: active.from, to });
      }
    },
    onResponderRelease: () => {
      const wasActive = activeRef.current !== null;
      clearTimer();
      if (wasActive) endDrag(true);
      else if (!movedRef.current) onPressItem?.(index);
    },
    onResponderTerminate: () => endDrag(false),
  });

  // Where each item sits while a drag is in progress
  const displayIndex = (i: number) => {
    if (!drag || i === drag.from) return i;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return i - 1;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return i + 1;
    return i;
  };

  return (
    <View style={{ width, height }}>
      {data.map((item, i) => {
        const isDragging = drag?.from === i;
        const s = slot(displayIndex(i));
        return (
          <Animated.View
            key={keyExtractor(item)}
            {...handlersFor(i)}
            style={[
              styles.cell,
              { width: cellWidth, height: cellHeight, left: s.x, top: s.y },
              isDragging && [
                styles.dragging,
                { left: slot(i).x, top: slot(i).y, transform: [...pan.getTranslateTransform(), { scale: 1.08 }] },
              ],
            ]}
          >
            {renderItem(item, i, isDragging)}
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Returns a copy of the array with one item moved. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const styles = StyleSheet.create({
  cell: {
    position: 'absolute',
  },
  dragging: {
    zIndex: 10,
    elevation: 8,
    opacity: 0.95,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});
