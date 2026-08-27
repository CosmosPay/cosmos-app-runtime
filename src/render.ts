import type { AppEvent, ComponentType, WireElement, WireNode } from "./types";

/**
 * Turns the wire tree into DOM.
 *
 * This runs on the main thread of a merchant's storefront, with a tree that
 * came from third-party code. Everything here is written on the assumption
 * that the tree is hostile: the app cannot be trusted not to try, and the
 * merchant is the one who pays if it succeeds.
 *
 * The rules, in one place:
 *
 *  - Nothing is ever assigned to `innerHTML`. Text goes through `textContent`,
 *    which cannot create nodes.
 *  - Attributes come off an allowlist per component. An attribute that is not
 *    on it is dropped, so no `onerror`, no `formaction`, no `srcdoc`.
 *  - URLs are parsed and their scheme checked. `javascript:` never reaches an
 *    `href` or a `src`.
 *  - Style properties come off an allowlist too, and values that contain a
 *    function call are refused.
 *  - Handlers are attached by the host from the ids in the tree. The tree
 *    itself never carries anything callable.
 */

/** Which HTML element each component becomes. */
const TAGS: Readonly<Record<ComponentType, string>> = {
	box: "div",
	row: "div",
	col: "div",
	txt: "span",
	button: "button",
	img: "img",
	link: "a",
	field: "input",
	check: "input",
	fragment: "div",
};

/** Attributes each component may set, beyond the ones handled explicitly. */
const ATTRS: Readonly<Record<ComponentType, readonly string[]>> = {
	box: ["id", "role", "tabIndex"],
	row: ["id", "role", "tabIndex"],
	col: ["id", "role", "tabIndex"],
	txt: ["id", "role"],
	button: ["id", "role", "disabled", "name", "value", "tabIndex"],
	img: ["id", "alt", "role"],
	link: ["id", "role", "target", "tabIndex"],
	field: ["id", "name", "value", "placeholder", "disabled", "role", "tabIndex"],
	check: ["id", "name", "value", "checked", "disabled", "role", "tabIndex"],
	fragment: [],
};

/** Style properties an app may set. Layout and looks, nothing that escapes. */
const STYLE_PROPS = new Set([
	"alignItems", "alignContent", "alignSelf", "background", "backgroundColor",
	"border", "borderColor", "borderRadius", "borderStyle", "borderWidth",
	"bottom", "boxShadow", "color", "columnGap", "cursor", "display", "flex",
	"flexBasis", "flexDirection", "flexGrow", "flexShrink", "flexWrap",
	"fontFamily", "fontSize", "fontStyle", "fontWeight", "gap", "gridColumn",
	"gridRow", "gridTemplateColumns", "gridTemplateRows", "height",
	"justifyContent", "justifyItems", "justifySelf", "left", "letterSpacing",
	"lineHeight", "margin", "marginBottom", "marginLeft", "marginRight",
	"marginTop", "maxHeight", "maxWidth", "minHeight", "minWidth", "objectFit",
	"opacity", "overflow", "overflowX", "overflowY", "padding", "paddingBottom",
	"paddingLeft", "paddingRight", "paddingTop", "position", "right", "rowGap",
	"textAlign", "textDecoration", "textOverflow", "textTransform", "top",
	"verticalAlign", "visibility", "whiteSpace", "width", "wordBreak", "zIndex",
]);

/** Schemes allowed in an `href`. */
const HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Schemes allowed in an image `src`. */
const SRC_SCHEMES = new Set(["http:", "https:"]);

/**
 * Returns the url if its scheme is allowed, otherwise null.
 *
 * Relative urls are resolved against the current document before checking, so
 * a value like `"/products/1"` passes and `"javascript:alert(1)"` does not.
 * Anything unparseable is refused rather than guessed at.
 */
function safeUrl(value: unknown, allowed: Set<string>): string | null {
	if (typeof value !== "string" || value === "") return null;
	// A leading control character or whitespace is how `java\nscript:` sneaks
	// past a naive check, so it goes before parsing, not after.
	const limpio = value.replace(/[\u0000-\u0020]/g, "");
	try {
		const url = new URL(limpio, document.baseURI);
		return allowed.has(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/** A style value with a function call in it is refused. */
function safeStyleValue(value: unknown): string | null {
	if (typeof value === "number") return String(value);
	if (typeof value !== "string") return null;
	// `url(...)`, `expression(...)`, `image-set(...)`: all of them let a value
	// reach out of the stylesheet. None is needed for layout.
	if (/[(){};@]/.test(value)) return null;
	return value;
}

function applyStyle(el: HTMLElement, style: unknown): void {
	if (typeof style !== "object" || style === null) return;
	for (const [prop, raw] of Object.entries(style as Record<string, unknown>)) {
		if (!STYLE_PROPS.has(prop)) continue;
		const value = safeStyleValue(raw);
		if (value === null) continue;
		// setProperty needs kebab-case; the style object property assignment
		// accepts camelCase and is the simpler of the two here.
		(el.style as unknown as Record<string, string>)[prop] = value;
	}
}

/** How the host is told that a DOM event fired. */
export type EventSink = (handlerId: string, event: AppEvent) => void;

function extractEvent(type: string, target: EventTarget | null): AppEvent {
	const evento: AppEvent = { type };
	if (target instanceof HTMLInputElement) {
		evento.value = target.value;
		evento.checked = target.checked;
		if (target.name) evento.name = target.name;
	} else if (
		target instanceof HTMLSelectElement ||
		target instanceof HTMLTextAreaElement
	) {
		evento.value = target.value;
		if (target.name) evento.name = target.name;
	} else if (target instanceof HTMLElement && target.getAttribute("name")) {
		evento.name = target.getAttribute("name") ?? undefined;
	}
	return evento;
}

function createElement(node: WireElement, sink: EventSink): HTMLElement | null {
	const tag = TAGS[node.type];
	if (!tag) return null;

	const el = document.createElement(tag);
	const props = node.props ?? {};

	if (node.type === "row" || node.type === "col") {
		el.style.display = "flex";
		el.style.flexDirection = node.type === "row" ? "row" : "column";
	}
	if (node.type === "check") {
		(el as HTMLInputElement).type = "checkbox";
	}
	if (node.type === "field") {
		// The input type comes from a separate prop with a restricted set, so
		// an app cannot ask for `type="file"` or anything that opens a dialog.
		const pedido = props.type_;
		const permitidos = ["text", "email", "number", "password", "search", "tel", "url"];
		(el as HTMLInputElement).type =
			typeof pedido === "string" && permitidos.includes(pedido) ? pedido : "text";
	}

	// After the row/col defaults so an app can override flexDirection, and
	// before the attributes so a style can never be what sets one.
	applyStyle(el, props.style);

	for (const attr of ATTRS[node.type]) {
		const value = props[attr];
		if (value === undefined || value === null || value === false) continue;
		if (attr === "disabled" || attr === "checked") {
			(el as HTMLInputElement & HTMLButtonElement)[attr as "disabled"] = true;
			continue;
		}
		if (attr === "tabIndex") {
			if (typeof value === "number") el.tabIndex = value;
			continue;
		}
		el.setAttribute(attr === "ariaLabel" ? "aria-label" : attr, String(value));
	}

	if (typeof props.ariaLabel === "string") {
		el.setAttribute("aria-label", props.ariaLabel);
	}
	if (typeof props.class === "string") {
		// Set through className rather than an attribute so a value containing
		// a quote cannot break out into another attribute.
		el.className = props.class;
	}

	if (node.type === "img") {
		const src = safeUrl(props.src, SRC_SCHEMES);
		if (src) (el as HTMLImageElement).src = src;
		// An image that came from an app is decorative until proven otherwise.
		if (typeof props.alt !== "string") el.setAttribute("alt", "");
	}

	if (node.type === "link") {
		const href = safeUrl(props.href, HREF_SCHEMES);
		if (href) (el as HTMLAnchorElement).href = href;
		if (el.getAttribute("target") === "_blank") {
			// Without this the opened page gets a handle on the storefront
			// through window.opener and can navigate it somewhere else.
			el.setAttribute("rel", "noopener noreferrer");
		}
	}

	if (typeof props.text === "string") {
		el.textContent = props.text;
	}

	for (const [domEvent, handlerId] of Object.entries(props.handlers ?? {})) {
		el.addEventListener(domEvent, (event) => {
			sink(handlerId, extractEvent(domEvent, event.target));
		});
	}

	for (const child of node.children ?? []) {
		const hijo = renderNode(child, sink);
		if (hijo) el.appendChild(hijo);
	}

	return el;
}

function renderNode(node: WireNode, sink: EventSink): globalThis.Node | null {
	// A string child becomes a text node, never markup.
	if (typeof node === "string") return document.createTextNode(node);
	return createElement(node, sink);
}

/**
 * Replaces the contents of `container` with the rendered tree.
 *
 * There is no diffing here on purpose. A first version that rebuilds is honest
 * about what it does; a diffing version that gets a case wrong leaves stale
 * nodes on a merchant's page, and that is worse than a repaint. The seam is
 * this function, so a keyed reconciler can land later without touching
 * anything else.
 */
export function render(
	container: HTMLElement,
	tree: WireNode,
	sink: EventSink,
): void {
	container.replaceChildren();
	const nodo = renderNode(tree, sink);
	if (nodo) container.appendChild(nodo);
}

export const __testing = { safeUrl, safeStyleValue, STYLE_PROPS, HREF_SCHEMES };
