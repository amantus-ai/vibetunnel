import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebAppManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  prefer_related_applications: boolean;
  icons: ManifestIcon[];
}

interface PngInfo {
  width: number;
  height: number;
  hasTransparency: boolean;
}

const assetsDirectory = path.resolve(process.cwd(), 'src/client/assets');

function readPngInfo(buffer: Buffer): PngInfo {
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let hasTransparencyChunk = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataOffset = offset + 8;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataOffset);
      height = buffer.readUInt32BE(dataOffset + 4);
      colorType = buffer[dataOffset + 9];
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true;
    } else if (type === 'IEND') {
      break;
    }

    offset = dataOffset + length + 4;
  }

  return {
    width,
    height,
    hasTransparency: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

describe('web app manifest', () => {
  let manifest: WebAppManifest;

  beforeAll(async () => {
    manifest = JSON.parse(
      await readFile(path.join(assetsDirectory, 'manifest.json'), 'utf8')
    ) as WebAppManifest;
  });

  it('defines the metadata required for a standalone installation', () => {
    expect(manifest).toMatchObject({
      name: 'VibeTunnel',
      short_name: 'VibeTunnel',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      prefer_related_applications: false,
    });
  });

  it('provides 192px and 512px install icons', () => {
    const generalPurposeSizes = manifest.icons
      .filter((icon) => !icon.purpose || icon.purpose.split(/\s+/).includes('any'))
      .map((icon) => icon.sizes);

    expect(generalPurposeSizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('keeps icon metadata aligned with the PNG files', async () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');

      const sizeMatch = /^(\d+)x(\d+)$/.exec(icon.sizes);
      expect(sizeMatch).not.toBeNull();

      const png = readPngInfo(
        await readFile(path.join(assetsDirectory, icon.src.replace(/^\//, '')))
      );

      expect(png.width).toBe(Number(sizeMatch?.[1]));
      expect(png.height).toBe(Number(sizeMatch?.[2]));

      if (icon.purpose?.split(/\s+/).includes('maskable')) {
        expect(png.hasTransparency).toBe(false);
      }
    }
  });
});
