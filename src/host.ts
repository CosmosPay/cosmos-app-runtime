import { render } from "./render";
import type { AppMessage, HostMessage, WireNode } from "./types";

/** The channel the host talks over. A `Worker` instance satisfies it. */
export interface HostChannel {
	postMessage(message: unknown): void;
	addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
	removeEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
	terminate?(): void;
}

export interface HostRuntimeOptions {
	/** Where the app's tree is rendered. Its contents are replaced. */
	container: HTMLElement;
	/** The worker running the app. */
	channel: HostChannel;
	/**
	 * How many nodes a single tree may contain. Default 5000.
	 *
	 * An app that sends a tree with a million nodes freezes the merchant's
	 * page, and it does not have to be malicious to do it: a loop over an
	 * unpaginated catalogue is enough.
	 */
	maxNodes?: number;
	/** Called when a tree is refused, with the reason. */
	onRefused?: (reason: string) => void;
}

export interface HostRuntime {
	/** Stops listening, clears the container and terminates the worker. */
	destroy(): void;
	/** How many trees have been rendered. Useful in tests. */
	readonly renderCount: number;
}

function countNodes(node: WireNode, limit: number): number {
	if (typeof node === "string") return 1;
	let total = 1;
	for (const child of node.children ?? []) {
		total += countNodes(child, limit);
		// Stop as soon as the limit is passed: counting the rest of a hostile
		// tree is doing the attacker's work.
		if (total > limit) return total;
	}
	return total;
}

/**
 * Creates the host side of the runtime, to be called on the storefront's main
 * thread.
 *
 * ```ts
 * const host = createHostRuntime({
 *   container: document.querySelector("#app-slot")!,
 *   channel: new Worker("/apps/gift-note.js"),
 * });
 * ```
 *
 * Everything the app sends is treated as untrusted input, because it is: the
 * worker runs code the merchant installed but did not write.
 */
export function createHostRuntime(options: HostRuntimeOptions): HostRuntime {
	const { container, channel, maxNodes = 5000, onRefused } = options;

	let renders = 0;

	const send = (message: HostMessage) => channel.postMessage(message);

	const onMessage = (event: { data: unknown }) => {
		const message = event.data as AppMessage;
		if (typeof message !== "object" || message === null) return;

		if (message.kind === "unmount") {
			container.replaceChildren();
			return;
		}

		if (message.kind !== "mount") return;

		const { tree } = message;
		if (typeof tree !== "string" && (typeof tree !== "object" || tree === null)) {
			onRefused?.("the tree is neither text nor an element");
			return;
		}

		const nodos = countNodes(tree, maxNodes);
		if (nodos > maxNodes) {
			onRefused?.(`the tree has more than ${maxNodes} nodes`);
			return;
		}

		render(container, tree, (handlerId, appEvent) => {
			send({ kind: "event", handlerId, event: appEvent });
		});

		renders += 1;
		send({ kind: "mounted" });
	};

	channel.addEventListener("message", onMessage);

	return {
		destroy() {
			channel.removeEventListener("message", onMessage);
			container.replaceChildren();
			channel.terminate?.();
		},
		get renderCount() {
			return renders;
		},
	};
}
