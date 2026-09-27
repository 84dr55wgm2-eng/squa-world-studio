/**
 * Glisser-déposer sur la vue 3D : une carte de la bibliothèque, ou des fichiers
 * .glb / .gltf depuis le bureau. L'objet est posé au point du sol visé.
 */
import { useState, type DragEvent } from 'react';
import { importModelFiles } from '../assets/assetActions.ts';
import { DRAG_MIME, addEntry, findEntry } from '../assets/libraryEntries.ts';
import { groundPointAtClient } from '../viewport/cameraController.ts';

const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files');

export function useViewportDrop() {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        const point = groundPointAtClient(e.clientX, e.clientY);
        const key = e.dataTransfer.getData(DRAG_MIME);
        if (key) {
          const entry = findEntry(key);
          if (entry) void addEntry(entry, point);
          return;
        }
        if (e.dataTransfer.files.length) void importModelFiles(e.dataTransfer.files, point);
      },
    },
  };
}
