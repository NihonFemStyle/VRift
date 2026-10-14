import type React from "react";
import { lazy } from "react";

/**
 * A component that loads the first time it is shown, from a module's named export:
 *   const ChatView = lazyNamed<typeof import("./ChatView").ChatView>(() => import("./ChatView"), "ChatView");
 * Render it inside <Suspense>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<T extends React.ComponentType<any>>(load: () => Promise<object>, key: string): T {
  return lazy(async () => ({ default: (await load())[key as keyof object] as T })) as unknown as T;
}
