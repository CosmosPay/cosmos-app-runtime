import {
	EVENT_PROPS,
	type Element,
	type EventHandler,
	type EventProp,
	type Node,
	type WireElement,
	type WireNode,
	type WireProps,
} from "./types";

/**
 * Turns the tree an app wrote into the tree that can cross the boundary.
 *
 * The only real work is the handlers. `postMessage` uses structured clone,
 * which throws on functions, so every handler is swapped for an id and kept in
 * a registry on this side. The host never receives anything callable, which is
 * also the point: code that runs in the storefront should not be able to hand
 * the page a function.
 */
export class HandlerRegistry {
	private readonly porId = new Map<string, EventHandler>();
	private siguiente = 0;

	/** Registers a handler and returns the id that stands in for it. */
	register(handler: EventHandler): string {
		this.siguiente += 1;
		const id = `h${this.siguiente.toString(36)}`;
		this.porId.set(id, handler);
		return id;
	}

	get(id: string): EventHandler | undefined {
		return this.porId.get(id);
	}

	/**
	 * Forgets every handler from the previous tree.
	 *
	 * Called before serializing a new one. Without this the map grows on every
	 * render for the lifetime of the worker, and a storefront app that renders
	 * on scroll would leak until the tab is closed.
	 */
	clear(): void {
		this.porId.clear();
	}

	get size(): number {
		return this.porId.size;
	}
}

function normalizeChildren(children: Node | Node[] | undefined): Node[] {
	if (children === undefined || children === null || children === false) return [];
	return Array.isArray(children) ? children : [children];
}

/**
 * Serializes one node. Returns `null` for anything that should not render,
 * which lets an app write `{cond && <thing/>}` without special cases.
 */
function serializeNode(
	node: Node,
	registry: HandlerRegistry,
): WireNode | null {
	if (node === null || node === undefined || node === false) return null;
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);

	return serializeElement(node, registry);
}

function serializeElement(
	element: Element,
	registry: HandlerRegistry,
): WireElement {
	const { type, props, children } = element;

	const wireProps: WireProps = {};
	const handlers: Record<string, string> = {};

	for (const [key, value] of Object.entries(props ?? {})) {
		if (key in EVENT_PROPS) {
			// A prop named like a handler that is not a function is dropped
			// rather than passed through: letting `onClick: "alert(1)"` reach
			// the host as data is how these runtimes grow an injection hole.
			if (typeof value !== "function") continue;
			const domEvent = EVENT_PROPS[key as EventProp];
			handlers[domEvent] = registry.register(value as EventHandler);
			continue;
		}
		// Any other function is dropped too: it could not be cloned anyway, and
		// throwing here would turn one bad prop into a blank storefront.
		if (typeof value === "function") continue;
		(wireProps as Record<string, unknown>)[key] = value;
	}

	if (Object.keys(handlers).length > 0) wireProps.handlers = handlers;

	const hijos = normalizeChildren(children)
		.map((child) => serializeNode(child, registry))
		.filter((child): child is WireNode => child !== null);

	const salida: WireElement = { type };
	if (Object.keys(wireProps).length > 0) salida.props = wireProps;
	if (hijos.length > 0) salida.children = hijos;
	return salida;
}

/**
 * Serializes a whole tree, forgetting the handlers of the previous one.
 *
 * Returns a plain string for a text root so the host does not have to special
 * case it.
 */
export function serialize(
	tree: Node,
	registry: HandlerRegistry,
): WireNode {
	registry.clear();
	return serializeNode(tree, registry) ?? "";
}
