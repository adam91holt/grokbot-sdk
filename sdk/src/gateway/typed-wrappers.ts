/**
 * Compile-time checks that first-class GrokBot methods match TypedCommandMap
 * and that unsafe commands stay unsugared.
 *
 * This module is imported by the test suite so `tsc` and the test run both
 * typecheck the wrappers. It has no runtime exports.
 */

import type { GrokBot } from "./client.js";
import type { TypedCommandMap, UnsafeGatewayCommand } from "./commands.js";
import { HOST_MANIFEST } from "./host-manifest.generated.js";

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type MethodOf<K extends keyof TypedCommandMap> = K extends keyof GrokBot ? K : never;

type _EveryTypedCommandIsAMethod = Expect<
  Eq<keyof TypedCommandMap, MethodOf<keyof TypedCommandMap>>
>;

type _ReturnMatches<K extends keyof TypedCommandMap> = GrokBot[K] extends (
  ...args: never[]
) => infer R
  ? R extends Promise<TypedCommandMap[K]["out"]>
    ? true
    : false
  : false;

type _AllReturnsMatch = Expect<
  {
    [K in keyof TypedCommandMap]: _ReturnMatches<K>;
  }[keyof TypedCommandMap] extends true
    ? true
    : false
>;

type Unsafe = UnsafeGatewayCommand;
type _UnsafeStayUnsugared = Expect<Unsafe extends keyof GrokBot ? false : true>;

type ManifestCommand = (typeof HOST_MANIFEST.commands)[number];
type _WrappersInExtractedTable = Expect<
  keyof TypedCommandMap extends ManifestCommand ? true : false
>;

void 0 as unknown as [
  _EveryTypedCommandIsAMethod,
  _AllReturnsMatch,
  _UnsafeStayUnsugared,
  _WrappersInExtractedTable,
];
