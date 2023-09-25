import { parse } from 'node:url';
import { z } from 'zod';
import { BundleRequestType } from '../types';

export type ParsedBundleConfig = z.infer<typeof bundleSearchParamSchema>;

const toBoolean = (val: z.infer<typeof boolean>): boolean => val === 'true';

const boolean = z.union([z.literal('true'), z.literal('false')]);
const bundleSearchParamSchema = z
  .object({
    // required
    platform: z.union([
      z.literal('android'),
      z.literal('ios'),
      z.literal('web'),
    ]),
    // optional
    dev: boolean.default('true').transform(toBoolean),
    minify: boolean.default('false').transform(toBoolean),
    runModule: boolean.default('false').transform(toBoolean),
  })
  .required();

export const parseBundleConfigFromRequestUrl = (
  requestUrl: string | undefined,
): {
  type: BundleRequestType;
  bundleConfig: ParsedBundleConfig | null;
} => {
  if (!requestUrl) {
    return { type: BundleRequestType.Unknown, bundleConfig: null };
  }

  const { pathname, query } = parse(requestUrl, true);
  if (typeof pathname !== 'string') {
    return {
      type: BundleRequestType.Unknown,
      bundleConfig: null,
    };
  }

  // eslint-disable-next-line no-nested-ternary -- allow nested ternary operator
  const type = pathname.endsWith('.bundle')
    ? BundleRequestType.Bundle
    : pathname.endsWith('.map')
    ? BundleRequestType.Sourcemap
    : BundleRequestType.Unknown;

  return {
    type,
    bundleConfig:
      type === BundleRequestType.Unknown
        ? null
        : bundleSearchParamSchema.parse(query),
  };
};
