import fs from 'node:fs/promises';
import deepmerge from 'deepmerge';
import { faker } from '@faker-js/faker';
import type { OnLoadArgs } from 'esbuild';
import type { PluginContext } from '@react-native-esbuild/core';
import {
  SUPPORT_PLATFORMS,
  type BundlerSupportPlatform,
} from '@react-native-esbuild/config';
import {
  addSuffix,
  stripSuffix,
  getSuffixedPath,
  resolveScaledAssets,
  getAssetRegistrationScript,
} from '../helpers';
import type { AssetScale, SuffixPathResult } from '../../types';

jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('image-size', () => ({
  imageSize: jest.fn().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test
    (_path, callback: (error: null, result: any) => void) => {
      callback(null, { width: 0, height: 0 });
    },
  ),
}));

describe('assetRegisterPlugin', () => {
  describe('addSuffix', () => {
    let filename: string;
    let extension: string;
    let scale: AssetScale;
    let platform: BundlerSupportPlatform;

    beforeEach(() => {
      filename = faker.string.alphanumeric(10);
      extension = faker.helpers.arrayElement(['.png', '.jpg', '.jpeg', '.gif']);
      scale = faker.number.int({ min: 1, max: 3 }) as AssetScale;
      platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
    });

    describe('when non-suffixed filename is present', () => {
      describe('when platform is present', () => {
        it('should add platform suffix', () => {
          expect(addSuffix(filename, extension, { platform })).toEqual(
            `${filename}.${platform}${extension}`,
          );
        });
      });

      describe('when scale is present', () => {
        it('should add scale suffix', () => {
          expect(addSuffix(filename, extension, { scale })).toEqual(
            `${filename}@${scale}x${extension}`,
          );
        });
      });

      describe('when platform and scale are present', () => {
        it('should add platform and scale suffix', () => {
          expect(addSuffix(filename, extension, { platform, scale })).toEqual(
            `${filename}@${scale}x.${platform}${extension}`,
          );
        });
      });
    });

    describe('when suffixed filename is present', () => {
      let previousScale: AssetScale;
      let suffixedFilename: string;

      beforeEach(() => {
        previousScale = faker.number.int({ min: 1, max: 3 }) as AssetScale;
        suffixedFilename = `${filename}@${previousScale}x${extension}`;
      });

      describe('when platform is present', () => {
        it('should add platform suffix', () => {
          expect(addSuffix(suffixedFilename, extension, { platform })).toEqual(
            `${filename}.${platform}${extension}`,
          );
        });
      });

      describe('when scale is present', () => {
        it('should override scale suffix', () => {
          expect(addSuffix(suffixedFilename, extension, { scale })).toEqual(
            `${filename}@${scale}x${extension}`,
          );
        });
      });

      describe('when platform and scale are present', () => {
        it('should add platform and override scale suffix', () => {
          expect(
            addSuffix(suffixedFilename, extension, { platform, scale }),
          ).toEqual(`${filename}@${scale}x.${platform}${extension}`);
        });
      });
    });
  });

  describe('stripSuffix', () => {
    let dirname: string;
    let filename: string;
    let extension: string;
    let scale: AssetScale;
    let platform: BundlerSupportPlatform;

    beforeEach(() => {
      dirname = `/root${faker.system.directoryPath()}`;
      filename = faker.string.alphanumeric(10);
      extension = faker.helpers.arrayElement(['.png', '.jpg', '.jpeg', '.gif']);
      scale = faker.number.int({ min: 1, max: 3 }) as AssetScale;
      platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
    });

    describe('when platform suffixed basename is present', () => {
      let basename: string;
      let strippedBasename: string;

      beforeEach(() => {
        basename = `${filename}.${platform}${extension}`;
        strippedBasename = stripSuffix(basename, extension);
      });

      it('should return stripped basename', () => {
        expect(strippedBasename).toEqual(filename);
      });
    });

    describe('when scale suffixed basename is present', () => {
      let basename: string;
      let strippedBasename: string;

      beforeEach(() => {
        basename = `${filename}@${scale}x${extension}`;
        strippedBasename = stripSuffix(basename, extension);
      });

      it('should return stripped basename', () => {
        expect(strippedBasename).toEqual(filename);
      });
    });

    describe('when platform and scale suffixed basename is present', () => {
      let basename: string;
      let strippedBasename: string;

      beforeEach(() => {
        basename = `${filename}@${scale}x.${platform}${extension}`;
        strippedBasename = stripSuffix(basename, extension);
      });

      it('should return stripped basename', () => {
        expect(strippedBasename).toEqual(filename);
      });
    });

    describe('when non-suffixed basename is present', () => {
      let basename: string;
      let strippedBasename: string;

      beforeEach(() => {
        basename = `${filename}${extension}`;
        strippedBasename = stripSuffix(basename, extension);
      });

      it('should return stripped basename', () => {
        expect(strippedBasename).toEqual(filename);
      });
    });
  });

  describe('getSuffixedPath', () => {
    let dirname: string;
    let filename: string;
    let extension: string;
    let pullPath: string;

    beforeEach(() => {
      dirname = `/root${faker.system.directoryPath()}`;
      filename = faker.string.alphanumeric(10);
      extension = faker.helpers.arrayElement(['.png', '.jpg', '.jpeg', '.gif']);
      pullPath = `${dirname}/${filename}${extension}`;
    });

    describe('when option is empty', () => {
      let suffixPathResult: SuffixPathResult;

      beforeEach(() => {
        suffixPathResult = getSuffixedPath(pullPath);
      });

      it('should return stripped basename', () => {
        expect(suffixPathResult.basename).toEqual(filename);
      });

      it('should return same path', () => {
        expect(suffixPathResult.path).toEqual(pullPath);
      });
    });

    describe('when `platform` is present', () => {
      let platform: BundlerSupportPlatform;
      let suffixPathResult: SuffixPathResult;

      beforeEach(() => {
        platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
        suffixPathResult = getSuffixedPath(pullPath, { platform });
      });

      it('should return stripped basename', () => {
        expect(suffixPathResult.basename).toEqual(filename);
      });

      it('should return platform suffixed path', () => {
        expect(suffixPathResult.path).toEqual(
          pullPath.replace(extension, `.${platform}${extension}`),
        );
      });
    });

    describe('when `scale` is present', () => {
      let scale: AssetScale;
      let suffixPathResult: SuffixPathResult;

      beforeEach(() => {
        scale = faker.number.int({ min: 1, max: 3 }) as AssetScale;
        suffixPathResult = getSuffixedPath(pullPath, { scale });
      });

      it('should return stripped basename', () => {
        expect(suffixPathResult.basename).toEqual(filename);
      });

      it('should return scale suffixed path', () => {
        expect(suffixPathResult.path).toEqual(
          pullPath.replace(extension, `@${scale}x${extension}`),
        );
      });
    });

    describe('when both `scale` and `platform` are present', () => {
      let platform: BundlerSupportPlatform;
      let scale: AssetScale;
      let suffixPathResult: SuffixPathResult;

      beforeEach(() => {
        platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
        scale = faker.number.int({ min: 1, max: 3 }) as AssetScale;
        suffixPathResult = getSuffixedPath(pullPath, { platform, scale });
      });

      it('should return stripped basename', () => {
        expect(suffixPathResult.basename).toEqual(filename);
      });

      it('should return platform and scale suffixed path', () => {
        expect(suffixPathResult.path).toEqual(
          pullPath.replace(extension, `@${scale}x.${platform}${extension}`),
        );
      });
    });
  });

  describe('resolveScaledAssets', () => {
    let dirname: string;
    let filename: string;
    let extension: string;
    let pullPath: string;
    let mockedContext: PluginContext;
    let mockedArgs: OnLoadArgs;

    beforeAll(() => {
      fs.readFile = jest.fn().mockReturnValue(() => '');
    });

    beforeEach(() => {
      dirname = faker.system.directoryPath();
      filename = faker.string.alphanumeric(10);
      extension = faker.helpers.arrayElement(['.png', '.jpg', '.jpeg', '.gif']);
      pullPath = `${dirname}/${filename}${extension}`;
      mockedContext = { root: faker.system.directoryPath() } as PluginContext;
      mockedArgs = {
        path: pullPath,
        pluginData: {
          basename: filename,
          extension,
          platform: null,
        },
      } as OnLoadArgs;
    });

    describe('when platform suffixed asset is exist', () => {
      let platform: BundlerSupportPlatform;

      beforeEach(() => {
        platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
        mockedArgs = deepmerge(mockedArgs, { pluginData: { platform } });

        fs.readdir = jest
          .fn()
          .mockImplementation((dirname: string): Promise<string[]> => {
            return Promise.resolve([
              `${dirname}/${filename}.${platform}${extension}`,
              `${dirname}/${filename}.unknown${extension}`,
            ]);
          });
      });

      it('should return single scale', async () => {
        const res = await resolveScaledAssets(mockedContext, mockedArgs);
        expect(res.scales.length).toEqual(1);
        expect(res.scales.includes(1)).toBeTruthy();
      });
    });

    describe('when platform and scale suffixed assets are exist', () => {
      let platform: BundlerSupportPlatform;

      beforeEach(() => {
        platform = faker.helpers.arrayElement(SUPPORT_PLATFORMS);
        mockedContext = deepmerge(mockedContext, { platform } as PluginContext);
        mockedArgs = deepmerge(mockedArgs, { pluginData: { platform } });

        fs.readdir = jest
          .fn()
          .mockImplementation((dirname: string): Promise<string[]> => {
            return Promise.resolve([
              `${dirname}/${filename}${extension}`,
              `${dirname}/${filename}@1x${extension}`,
              `${dirname}/${filename}@2x${extension}`,
              `${dirname}/${filename}@3x${extension}`,
              `${dirname}/${filename}.${platform}${extension}`,
              `${dirname}/${filename}@2x.${platform}${extension}`,
              `${dirname}/${filename}@3x.${platform}${extension}`,
              `${dirname}/${filename}@4x.unknown${extension}`,
            ]);
          });
      });

      it('should return all of suffixed scale', async () => {
        const res = await resolveScaledAssets(mockedContext, mockedArgs);
        expect(res.scales.length).toEqual(3);
        expect(res.scales.includes(1)).toBeTruthy();
        expect(res.scales.includes(2)).toBeTruthy();
        expect(res.scales.includes(3)).toBeTruthy();
        expect(res.scales.includes(4)).not.toBeTruthy();
      });
    });

    describe('when scale suffixed assets are exist', () => {
      beforeEach(() => {
        fs.readdir = jest
          .fn()
          .mockImplementation((dirname: string): Promise<string[]> => {
            return Promise.resolve([
              `${dirname}/${filename}@1x${extension}`,
              `${dirname}/${filename}@2x${extension}`,
              `${dirname}/${filename}@3x${extension}`,
            ]);
          });
      });

      it('should return all of scale suffixed assets', async () => {
        const res = await resolveScaledAssets(mockedContext, mockedArgs);
        expect(res.scales.length).toEqual(3);
        expect(res.scales.includes(1)).toBeTruthy();
        expect(res.scales.includes(2)).toBeTruthy();
        expect(res.scales.includes(3)).toBeTruthy();
      });
    });

    describe('when only non-suffixed assets are exist', () => {
      beforeEach(() => {
        fs.readdir = jest
          .fn()
          .mockImplementation((dirname: string): Promise<string[]> => {
            return Promise.resolve([`${dirname}/${filename}${extension}`]);
          });
      });

      it('should return single scale', async () => {
        const res = await resolveScaledAssets(mockedContext, mockedArgs);
        expect(res.scales.length).toEqual(1);
        expect(res.scales.includes(1)).toBeTruthy();
      });
    });

    describe('when only @1x suffixed asset is exist', () => {
      beforeEach(() => {
        fs.readdir = jest
          .fn()
          .mockImplementation((dirname: string): Promise<string[]> => {
            return Promise.resolve([`${dirname}/${filename}@1x${extension}`]);
          });
      });

      it('should return single scale', async () => {
        const res = await resolveScaledAssets(mockedContext, mockedArgs);
        expect(res.scales.length).toEqual(1);
        expect(res.scales.includes(1)).toBeTruthy();
      });
    });
  });

  describe('getAssetRegistrationScript', () => {
    let assetRegistrationScript: string;

    beforeEach(() => {
      assetRegistrationScript = getAssetRegistrationScript({
        name: 'image',
        type: 'png',
        scales: [1, 2, 3],
        hash: 'hash',
        httpServerLocation: '/image.png',
        dimensions: {
          width: 0,
          height: 0,
        },
      });
    });

    it('should match snapshot', () => {
      expect(assetRegistrationScript).toMatchSnapshot();
    });
  });
});
