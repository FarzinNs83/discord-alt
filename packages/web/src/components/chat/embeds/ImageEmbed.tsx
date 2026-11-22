import React from 'react';
import type { Embed } from '@patogh/shared';
import { useUIStore } from '../../../stores/uiStore';
import { TapToLoad } from '../TapToLoad';

interface ImageEmbedProps {
  embed: Embed;
}

export function ImageEmbed({ embed }: ImageEmbedProps) {
  const openImagePreview = useUIStore((s) => s.openImagePreview);
  const imageUrl = embed.image ?? embed.url;
  const { width, height } = embed;

  return (
    <TapToLoad width={width} height={height}>
    <div className="mt-2 max-w-fit">
      <div
        className="relative rounded-lg overflow-hidden"
        style={width && height ? { aspectRatio: `${width}/${height}`, maxWidth: Math.min(width, 400), maxHeight: 300 } : undefined}
      >
        <img
          src={imageUrl}
          alt={embed.title ?? ''}
          className="w-full h-full max-w-[400px] max-h-[300px] object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
          referrerPolicy="no-referrer"
          onClick={() => openImagePreview(imageUrl)}
        />
      </div>
    </div>
    </TapToLoad>
  );
}
