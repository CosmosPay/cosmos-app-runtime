/**
 * The component vocabulary and the wire protocol between the app and the host.
 *
 * Zero imports on purpose: both sides of the boundary depend on this file, and
 * one of them runs in a Web Worker where nothing else is available.
 */

/** A style declaration. Only the properties on the allowlist survive rendering. */
export type Style = Readonly<Record<string, string | number>>;

/** What an app writes. Handlers are real functions on this side. */
export type Node =
	| string
	| number
	| null
	| undefined
	| false
	| Element;

export interface Element {
	type: ComponentType;
	props?: Props;
	children?: Node | Node[];
}

export interface Props {
	style?: Style;
	class?: string;
	id?: string;
	/** Only meaningful on `img` and `link`. Validated before it reaches the DOM. */
	src?: string;
	href?: string;
	alt?: string;
	text?: string;
	name?: string;
	value?: string;
	placeholder?: string;
	disabled?: boolean;
	checked?: boolean;
	type_?: string;
	role?: string;
	ariaLabel?: string;
	tabIndex?: number;
	target?: string;
	onClick?: EventHandler;
	onChange?: EventHandler;
	onInput?: EventHandler;
	onSubmit?: EventHandler;
	[key: string]: unknown;
}

/** Called in the app when the corresponding DOM event fires on the host. */
export type EventHandler = (event: AppEvent) => void;

/**
 * What the app receives instead of a DOM event.
 *
 * A real `Event` cannot cross the boundary and a Worker has no DOM anyway, so
 * the host extracts the few fields an app can act on and sends those. Anything
 * that would require a live node reference is deliberately absent.
 */
export interface AppEvent {
	type: string;
	/** The value of the input that emitted it, when there is one. */
	value?: string;
	/** The `checked` state, for checkboxes and radios. */
	checked?: boolean;
	/** The `name` prop of the emitting component, when it has one. */
	name?: string;
}

/** The component types this runtime knows how to render. */
export type ComponentType =
	| "box"
	| "row"
	| "col"
	| "txt"
	| "button"
	| "img"
	| "link"
	| "field"
	| "check"
	| "fragment";

/* -------------------------------------------------------------------------- */
/*                              The wire format                               */
/* -------------------------------------------------------------------------- */

/**
 * The tree as it crosses the boundary: the same shape, with every handler
 * replaced by an id. This is structured-cloneable, which the tree with real
 * functions is not.
 */
export type WireNode = string | WireElement;

export interface WireElement {
	type: ComponentType;
	props?: WireProps;
	children?: WireNode[];
}

export type WireProps = Omit<
	Props,
	"onClick" | "onChange" | "onInput" | "onSubmit"
> & {
	/** Maps a DOM event name to the handler id the app registered for it. */
	handlers?: Readonly<Record<string, string>>;
};

/** App to host. */
export type AppMessage =
	| { kind: "mount"; tree: WireNode }
	| { kind: "unmount" };

/** Host to app. */
export type HostMessage =
	| { kind: "event"; handlerId: string; event: AppEvent }
	| { kind: "mounted" };

/** Which DOM events the runtime forwards, and the prop each one comes from. */
export const EVENT_PROPS = {
	onClick: "click",
	onChange: "change",
	onInput: "input",
	onSubmit: "submit",
} as const;

export type EventProp = keyof typeof EVENT_PROPS;
