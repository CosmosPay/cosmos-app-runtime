import { HandlerRegistry, serialize } from "./serialize";
import type { AppMessage, HostMessage, Node } from "./types";

/** What an app gets to talk to the host. */
export interface AppRuntime {
	/** Serializes the tree and sends it to be rendered. */
	mount(tree: Node): void;
	/** Asks the host to clear the container. */
	unmount(): void;
	/** Resolves once the host has rendered at least one tree. */
	ready(): Promise<void>;
	/** Stops listening. The handlers of the last tree are forgotten. */
	destroy(): void;
	/** How many handlers the current tree registered. Useful in tests. */
	readonly handlerCount: number;
}

/** The channel the runtime talks over. A Worker's global scope satisfies it. */
export interface Channel {
	postMessage(message: unknown): void;
	addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
	removeEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
}

/**
 * Creates the app side of the runtime, to be called from inside the Worker.
 *
 * ```ts
 * const app = createAppRuntime(self);
 *
 * app.mount({
 *   type: "col",
 *   props: { style: { gap: "8px" } },
 *   children: [
 *     { type: "txt", props: { text: "Add a gift note" } },
 *     { type: "button", props: { text: "Add", onClick: () => alta() } },
 *   ],
 * });
 * ```
 *
 * The app never sees the DOM. It describes what it wants and gets told when
 * something happened, which is the whole reason a storefront can afford to run
 * third-party code at all.
 */
export function createAppRuntime(channel: Channel): AppRuntime {
	const registry = new HandlerRegistry();

	let resolverListo: (() => void) | null = null;
	const listo = new Promise<void>((resolve) => {
		resolverListo = resolve;
	});

	const onMessage = (event: { data: unknown }) => {
		const message = event.data as HostMessage;
		if (typeof message !== "object" || message === null) return;

		if (message.kind === "mounted") {
			resolverListo?.();
			return;
		}

		if (message.kind === "event") {
			const handler = registry.get(message.handlerId);
			// A stale id is normal, not an error: an event can be in flight
			// while a new tree replaces the handler it belonged to.
			if (!handler) return;
			try {
				handler(message.event);
			} catch (error) {
				// An app handler that throws must not take the message loop
				// with it, or the app stops responding to every later event.
				console.error("[cosmos] a handler threw:", error);
			}
		}
	};

	channel.addEventListener("message", onMessage);

	const send = (message: AppMessage) => channel.postMessage(message);

	return {
		mount(tree) {
			send({ kind: "mount", tree: serialize(tree, registry) });
		},
		unmount() {
			registry.clear();
			send({ kind: "unmount" });
		},
		ready() {
			return listo;
		},
		destroy() {
			channel.removeEventListener("message", onMessage);
			registry.clear();
		},
		get handlerCount() {
			return registry.size;
		},
	};
}
